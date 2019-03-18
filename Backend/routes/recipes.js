var express = require('express');
var router = express.Router();
var cors = require('cors');
var xmljs = require("xml-js");
var Raven = require('raven');

// DB
var Op = require("sequelize").Op;
var SQ = require('../models').sequelize;
var User = require('../models').User;
var Recipe = require('../models').Recipe;
var Label = require('../models').Label;

// Service
var MiddlewareService = require('../services/middleware');
var UtilService = require('../services/util');
let ElasticService = require('../services/elastic');

//Create a new recipe
router.post(
  '/',
  cors(),
  MiddlewareService.validateSession(['user']),
  UtilService.upload.single('image'),
  function(req, res, next) {

  // If sending to another user, folder should be inbox. Otherwise, main.
  let folder = req.body.destinationUserEmail ? 'inbox' : 'main';

  // Check for title
  if (!req.body.title || req.body.title.length === 0) {
    // This request is bad due to no title, but we already uploaded an image for it. Delete the image before erroring out
    if (req.file && req.file.key) {
      UtilService.deleteS3Object(req.file.key, function() {
        res.status(412).send("Recipe title must be provided.");
      }, next);
    } else {
      res.status(412).send("Recipe title must be provided.");
    }
  } else {
    SQ.transaction(t => {

      // Support for imageURLs instead of image files
      return new Promise(function(resolve, reject) {
        if (req.body.imageURL) {
          UtilService.sendURLToS3(req.body.imageURL).then(resolve).catch(reject);
        } else {
          resolve(null);
        }
      }).then(function(img) {
        var uploadedFile = img || req.file;

        return Recipe.findTitle(res.locals.session.userId, null, req.body.title, t).then(function(adjustedTitle) {
          return Recipe.create({
            userId: res.locals.session.userId,
            title: adjustedTitle,
            description: req.body.description || '',
            yield: req.body.yield || '',
            activeTime: req.body.activeTime || '',
            totalTime: req.body.totalTime || '',
            source: req.body.source || '',
            url: req.body.url || '',
            notes: req.body.notes || '',
            ingredients: req.body.ingredients || '',
            instructions: req.body.instructions || '',
            image: uploadedFile,
            folder: folder
          }, {
            transaction: t
          });
        });
      })
    }).then(recipe => {
      var serializedRecipe = recipe.toJSON();
      serializedRecipe.labels = [];
      res.status(201).json(serializedRecipe);
    }).catch(function (err) {
      if (req.file) {
        return UtilService.deleteS3Object(req.file.key).then(function () {
          next(err);
        }).catch(function () {
          next(err);
        });
      }

      next(err);
    });
  }
});

//Get all of a user's recipes
router.get(
  '/',
  cors(),
  MiddlewareService.validateSession(['user']),
  function(req, res, next) {

  Recipe.findAll({
    where: {
      userId: res.locals.session.userId,
      folder: req.query.folder
    },
    attributes: ['id', 'title', 'description', 'source', 'url', 'image', 'folder', 'fromUserId', 'createdAt', 'updatedAt'],
    include: [{
      model: User,
      as: 'fromUser',
      attributes: ['name', 'email']
    },
    {
      model: Label,
      as: 'labels',
      attributes: ['id', 'title']
    }],
    order: [
      ['title', 'ASC']
    ],
  }).then(function(recipes) {
    res.status(200).json(recipes);
  }).catch(next);
});

// Count a user's recipes
router.get(
  '/count',
  cors(),
  MiddlewareService.validateSession(['user']),
  function(req, res, next) {

  Recipe.count({
    where: {
      userId: res.locals.session.userId,
      folder: req.query.folder || 'main'
    }
  }).then(count => {
    res.status(200).json({
      count
    });
  }).catch(next);
});

//Get all of a user's recipes (paginated)
router.get(
  '/by-page',
  cors(),
  MiddlewareService.validateSession(['user']),
  function(req, res, next) {

  let sort = ['title', 'ASC'];
  if (req.query.sort) {
    switch(req.query.sort){
      case "-title":
        sort = ['title', 'ASC'];
        break;
      case "createdAt":
        sort = ['createdAt', 'ASC'];
        break;
      case "-createdAt":
        sort = ['createdAt', 'DESC'];
        break;
      case "updatedAt":
        sort = ['updatedAt', 'ASC'];
        break;
      case "-updatedAt":
        sort = ['updatedAt', 'DESC'];
        break;
    }
  }

  let labelFilter = {}
  if (req.query.labels) {
    labelFilter.where = {
      title: req.query.labels.split(',')
    }
  }

  Recipe.findAndCountAll({
    where: {
      userId: res.locals.session.userId,
      folder: req.query.folder || 'main'
    },
    attributes: ['id', 'title', 'description', 'source', 'url', 'image', 'folder', 'fromUserId', 'createdAt', 'updatedAt'],
    include: [{
      model: User,
      as: 'fromUser',
      attributes: ['name', 'email']
    },
    {
      model: Label,
      as: 'labels',
      attributes: ['id', 'title'],
      ...labelFilter
    }],
    order: [
      sort
    ],
    limit: Math.min(parseInt(req.query.count) || 100, 500),
    offset: req.query.offset || 0
  }).then(({ count, rows }) => {
    res.status(200).json({
      data: rows,
      totalCount: count
    });
  }).catch(next);
});

router.get(
  '/search',
  cors(),
  MiddlewareService.validateSession(['user']),
  function(req, res, next) {
    ElasticService.search('recipes', res.locals.session.userId, req.query.query).then(results => {
      let searchHits = results.hits.hits;

      let searchHitsByRecipeId = searchHits.reduce((acc, hit) => {
        acc[hit._id] = hit;
        return acc;
      }, {});

      let labelFilter = {}
      if (req.query.labels) {
        labelFilter.where = {
          title: req.query.labels.split(',')
        }
      }

      return Recipe.findAll({
        where: {
          id: { [Op.in]: Object.keys(searchHitsByRecipeId) },
          userId: res.locals.session.userId,
          folder: 'main'
        },
        include: [{
          model: Label,
          as: 'labels',
          attributes: ['id', 'title'],
          ...labelFilter
        }],
        limit: 200
      }).then(recipes => {
        res.status(200).send({
          data: recipes.sort((a, b) => {
            return searchHitsByRecipeId[b.id]._score - searchHitsByRecipeId[a.id]._score;
          })
        });
      })
    }).catch(next);
  }
)

router.get(
  '/export',
  cors(),
  MiddlewareService.validateSession(['user']),
  function(req, res, next) {

  Recipe.findAll({
    where: {
      userId: res.locals.session.userId,
    },
    include: [{
      model: User,
      as: 'fromUser',
      attributes: ['name', 'email']
    },
    {
      model: Label,
      as: 'labels',
      attributes: ['title']
    }],
    order: [
      ['title', 'ASC']
    ],
  }).then(function(recipes) {
    let recipes_j = recipes.map(e => e.toJSON());

    var data;
    var mimetype;

    switch (req.query.format) {
      case 'json':
        data = JSON.stringify(recipes_j);
        mimetype = 'application/json';
        break;
      case 'xml':
        data = xmljs.json2xml(recipes_j, { compact: true, ignoreComment: true, spaces: 4 });
        mimetype = 'text/xml';
        break;
      case 'txt':
        data = '';

        for (var i = 0; i < recipes_j.length; i++) {
          let recipe = recipes_j[i];

          recipe.labels = recipe.labels.map(function (el) {
            return el.title;
          }).join(',');

          for (var key in recipe) {
            if (recipe.hasOwnProperty(key)) {
              data += key + ': ';
              data += recipe[key] + '\r\n';
            }

          }
          data += '\r\n';
        }

        res.charset = 'UTF-8';
        mimetype = 'text/plain';
        break;
      default:
        res.status(400).send('Unknown export format. Please send json, xml, or txt.');
        return;
    }

    res.setHeader('Content-disposition', 'attachment; filename=recipes-' + Date.now() + '.' + req.query.format);
    res.setHeader('Content-type', mimetype);
    res.write(data);
    res.end();
  }).catch(next);
});

//Get a single recipe
router.get(
  '/:recipeId',
  cors(),
  MiddlewareService.validateSession(['user']),
  function(req, res, next) {

  Recipe.findOne({
    where: {
      userId: res.locals.session.userId,
      id: req.params.recipeId
    },
    include: [{
      model: User,
      as: 'fromUser',
      attributes: ['name', 'email']
    },
    {
      model: Label,
      as: 'labels',
      attributes: ['id', 'title', 'createdAt', 'updatedAt']
    }],
    order: [
      ['title', 'ASC']
    ],
  }).then(function(recipe) {
    if (!recipe) {
      res.status(404).send("Recipe with that ID not found!");
    } else {
      res.status(200).json(recipe);
    }
  }).catch(next);
});

//Update a recipe
router.put(
  '/:id',
  cors(),
  MiddlewareService.validateSession(['user']),
  UtilService.upload.single('image'),
  function(req, res, next) {

  Recipe.findOne({
    where: {
      id: req.params.id,
      userId: res.locals.session.userId
    }
  }).then(function(recipe) {
    if (!recipe) {
      res.status(404).json({
        msg: "Recipe with that ID does not exist!"
      });
    } else {
      return SQ.transaction(function(t) {
        if (req.body.description && typeof req.body.description === 'string') recipe.description = req.body.description;
        if (req.body.yield && typeof req.body.yield === 'string') recipe.yield = req.body.yield;
        if (req.body.activeTime && typeof req.body.activeTime === 'string') recipe.activeTime = req.body.activeTime;
        if (req.body.totalTime && typeof req.body.totalTime === 'string') recipe.totalTime = req.body.totalTime;
        if (req.body.source && typeof req.body.source === 'string') recipe.source = req.body.source;
        if (req.body.url && typeof req.body.url === 'string') recipe.url = req.body.url;
        if (req.body.notes && typeof req.body.notes === 'string') recipe.notes = req.body.notes;
        if (req.body.ingredients && typeof req.body.ingredients === 'string') recipe.ingredients = req.body.ingredients;
        if (req.body.instructions && typeof req.body.instructions === 'string') recipe.instructions = req.body.instructions;
        if (req.body.folder && typeof req.body.folder === 'string') recipe.folder = req.body.folder;

        // Check if user uploaded a new image. If so, delete the old image to save space and $$
        var oldImage = recipe.image;
        if (req.file) {
          recipe.image = req.file;
        }

        return Recipe.findTitle(res.locals.session.userId, recipe.id, req.body.title || recipe.title, t).then(function(adjustedTitle) {
          recipe.title = adjustedTitle;

          return recipe.save({transaction: t}).then(function (recipe) {
            // Remove old (replaced) image from our S3 bucket
            if (req.file && oldImage && oldImage.key) {
              return UtilService.deleteS3Object(oldImage.key).then(function() {
                res.status(200).json(recipe);
              });
            }

            res.status(200).json(recipe);
          });
        });
      });
    }
  }).catch(function(err) {
    if (req.file) {
      return UtilService.deleteS3Object(req.file.key).then(function() {
        next(err);
      }).catch(function() {
        next(err);
      });
    }

    next(err);
  });
});

router.delete(
  '/all',
  cors(),
  MiddlewareService.validateSession(['user']),
  function(req, res, next) {

  SQ.transaction(t => {
    return Recipe.destroy({
      where: {
        userId: res.locals.session.userId
      },
      transaction: t
    }).then(() => {
      return Label.destroy({
        where: {
          userId: res.locals.session.userId
        },
        transaction: t
      })
    })
  }).then(() => {
    res.status(200).send({})
  }).catch(next);
})

router.delete(
  '/:id',
  cors(),
  MiddlewareService.validateSession(['user']),
  function(req, res, next) {

  Recipe.findOne({
    where: {
      id: req.params.id,
      userId: res.locals.session.userId
    },
    attributes: ['id'],
    include: [{
      model: Label,
      as: "labels",
      attributes: ['id'],
      include: [{
        model: Recipe,
        as: "recipes",
        attributes: ['id']
      }]
    }]
  })
  .then(function(recipe) {
    if (!recipe) {
      res.status(404).json({
        msg: "Recipe with specified ID does not exist!"
      });
    } else {
      return SQ.transaction(function(t) {
        return recipe.destroy({transaction: t}).then(function() {
          // Get an array of labelIds which have only this recipe associated
          labelIds = recipe.labels.reduce(function(acc, label) {
            if (label.recipes.length <= 1) {
              acc.push(label.id);
            }
            return acc;
          }, []);

          return Label.destroy({
            where: {
              id: { [Op.in]: labelIds }
            },
            transaction: t
          });
        });
      }).then(() => {
        res.status(200).json(recipe);
      });
    }
  })
  .catch(next);
});


module.exports = router;
