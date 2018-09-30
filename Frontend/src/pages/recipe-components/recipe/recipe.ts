import { Component } from '@angular/core';
import { IonicPage, NavController, NavParams, AlertController, ToastController, ModalController } from 'ionic-angular';

import { RecipeServiceProvider, Recipe } from '../../../providers/recipe-service/recipe-service';
import { LabelServiceProvider } from '../../../providers/label-service/label-service';
import { LoadingServiceProvider } from '../../../providers/loading-service/loading-service';
import { UtilServiceProvider } from '../../../providers/util-service/util-service';

@IonicPage({
  segment: 'recipe/:recipeId',
  priority: 'high'
})
@Component({
  selector: 'page-recipe',
  templateUrl: 'recipe.html',
  providers: [ RecipeServiceProvider, LabelServiceProvider ]
})
export class RecipePage {

  recipe: Recipe;
  recipeId: string;
  ingredients: any;
  instructions: string[];

  scale: number = 1;

  labelObjectsByTitle: any = {};
  existingLabels: any = [];
  selectedLabels: any = [];
  pendingLabel: string = '';
  showAutocomplete: boolean = false;
  autocompleteSelectionIdx: number = -1;

  constructor(
    public navCtrl: NavController,
    public alertCtrl: AlertController,
    public toastCtrl: ToastController,
    public modalCtrl: ModalController,
    public loadingService: LoadingServiceProvider,
    public navParams: NavParams,
    public utilService: UtilServiceProvider,
    public recipeService: RecipeServiceProvider,
    public labelService: LabelServiceProvider) {

    this.recipeId = navParams.get('recipeId');
    this.recipe = <Recipe>{};

    this.applyScale();
  }

  ionViewWillEnter() {
    var loading = this.loadingService.start();

    this.recipe = <Recipe>{};

    Promise.all([this.loadRecipe(), this.loadLabels()])
    .then(function () {
      loading.dismiss();
    }, function () {
      loading.dismiss();
    });
  }

  refresh(loader) {
    Promise.all([this.loadRecipe(), this.loadLabels()])
    .then(function () {
      loader.complete();
    }, function () {
      loader.complete();
    });
  }

  loadRecipe() {
    var me = this;

    return new Promise(function(resolve, reject) {
      me.recipeService.fetchById(me.recipeId).subscribe(function(response) {
        me.recipe = response;

        if (me.recipe.instructions && me.recipe.instructions.length > 0) {
          me.instructions = me.recipe.instructions.split(/\r?\n/);
        }

        me.applyScale();

        resolve();
      }, function(err) {
        switch(err.status) {
          case 0:
            let offlineToast = me.toastCtrl.create({
              message: me.utilService.standardMessages.offlineFetchMessage,
              duration: 5000
            });
            offlineToast.present();
            break;
          case 401:
            me.navCtrl.setRoot('LoginPage', {}, {animate: true, direction: 'forward'});
            break;
          case 404:
            let errorToast = me.toastCtrl.create({
              message: 'Recipe not found. Does this recipe URL exist?',
              duration: 30000,
              dismissOnPageChange: true
            });
            errorToast.present();
            break;
          default:
            errorToast = me.toastCtrl.create({
              message: me.utilService.standardMessages.unexpectedError,
              duration: 30000
            });
            errorToast.present();
            break;
        }

        reject();
      });
    });
  }

  loadLabels() {
    var me = this;

    return new Promise(function(resolve, reject) {
      me.labelService.fetch().subscribe(function(response) {
        for (var i = 0; i < response.length; i++) {
          var label = response[i];
          me.existingLabels.push(label.title);
          me.labelObjectsByTitle[label.title] = label;

          if (label.recipes.findIndex(function(el) { return el.id === me.recipeId }) > -1) {
            me.selectedLabels.push(label.title);
          }
        }

        me.existingLabels.sort(function(a, b) {
          if (me.labelObjectsByTitle[a].recipes.length === me.labelObjectsByTitle[b].recipes.length) return 0;
          return me.labelObjectsByTitle[a].recipes.length > me.labelObjectsByTitle[b].recipes.length ? -1 : 1;
        });

        resolve();
      }, function(err) {
        reject();

        switch(err.status) {
          case 0:
          case 401:
            // Ignore, handled by main loader
            break;
          default:
            let errorToast = me.toastCtrl.create({
              message: me.utilService.standardMessages.unexpectedError,
              duration: 30000
            });
            errorToast.present();
            break;
        }
      });
    });
  }

  ionViewDidLoad() {}

  changeScale() {
    this.recipeService.scaleIngredientsPrompt(this.scale, (scale) => {
      this.scale = scale;
      this.applyScale();
    });
  }

  applyScale() {
    this.ingredients = this.recipeService.scaleIngredients(this.recipe.ingredients, this.scale, true);
  }

  editRecipe() {
    this.navCtrl.push('EditRecipePage', {
      recipe: this.recipe
    });
  }

  deleteRecipe() {
    let alert = this.alertCtrl.create({
      title: 'Confirm Delete',
      message: 'This will permanently delete the recipe from your account. This action is irreversible.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          handler: () => {}
        },
        {
          text: 'Delete',
          cssClass: 'alertDanger',
          handler: () => {
            this._deleteRecipe();
          }
        }
      ]
    });
    alert.present();
  }

  private _deleteRecipe() {
    var me = this;

    var loading = this.loadingService.start();

    this.recipeService.remove(this.recipe).subscribe(function(response) {
      loading.dismiss();

      me.navCtrl.setRoot('HomePage', { folder: me.recipe.folder }, {animate: true, direction: 'forward'});
    }, function(err) {
      loading.dismiss();
      switch(err.status) {
        case 0:
          me.toastCtrl.create({
            message: me.utilService.standardMessages.offlinePushMessage,
            duration: 5000
          }).present();
          break;
        case 401:
          me.toastCtrl.create({
            message: me.utilService.standardMessages.unauthorized,
            duration: 6000
          }).present();
          break;
        case 404:
          me.toastCtrl.create({
            message: 'Can\'t find the recipe you\'re trying to delete.',
            duration: 6000
          }).present();
          break;
        default:
          me.toastCtrl.create({
            message: me.utilService.standardMessages.unexpectedError,
            duration: 6000
          }).present();
          break;
      }
    });
  }

  addRecipeToShoppingList() {
    let addRecipeToShoppingListModal = this.modalCtrl.create('AddRecipeToShoppingListModalPage', {
      recipe: this.recipe,
      recipeScale: this.scale
    });
    addRecipeToShoppingListModal.present();
  }

  printRecipe() {
    let printRecipeModal = this.modalCtrl.create('PrintRecipeModalPage', { recipe: this.recipe });
    printRecipeModal.present();
  }

  shareRecipe() {
    var me = this;

    let shareModal = this.modalCtrl.create('ShareModalPage', { recipe: this.recipe });
    shareModal.present();
    shareModal.onDidDismiss(data => {
      if (!data || !data.destination) return;

      if (data.setRoot) {
        me.navCtrl.setRoot(data.destination, data.routingData || {}, {animate: true, direction: 'forward'});
      } else {
        me.navCtrl.push(data.destination, data.routingData);
      }
    });
  }

  moveToFolder(folderName) {
    var me = this;

    var loading = this.loadingService.start();

    this.recipe.folder = folderName;

    console.log(this.recipe)

    this.recipeService.update(this.recipe).subscribe(function(response) {
      loading.dismiss();

      me.navCtrl.setRoot('RecipePage', {
        recipe: response,
        recipeId: response.id
      }, {animate: true, direction: 'forward'});
    }, function(err) {
      loading.dismiss();
      switch(err.status) {
        case 0:
          me.toastCtrl.create({
            message: me.utilService.standardMessages.offlinePushMessage,
            duration: 5000
          }).present();
          break;
        case 401:
          me.toastCtrl.create({
            message: me.utilService.standardMessages.unauthorized,
            duration: 6000
          }).present();
          break;
        default:
          me.toastCtrl.create({
            message: me.utilService.standardMessages.unexpectedError,
            duration: 6000
          }).present();
          break;
      }
    });
  }

  toggleAutocomplete(show, event?) {
    if (event && event.relatedTarget) {
      if (event.relatedTarget.className.indexOf('suggestion') > -1) {
        return;
      }
    }
    this.showAutocomplete = show;
    this.autocompleteSelectionIdx = -1;
  }

  labelFieldKeyUp(event) {
    // Only listen for up or down arrow
    if (event.keyCode !== 38 && event.keyCode !== 40) return;

    // Get all suggestions (including click to create)
    var suggestions = document.getElementsByClassName('autocomplete')[0].children;

    // If result list size was reduced, do not overflow
    if (this.autocompleteSelectionIdx > suggestions.length - 1) this.autocompleteSelectionIdx = suggestions.length - 1;

    if (event.keyCode === 40 && this.autocompleteSelectionIdx < suggestions.length - 1) {
      // Arrow Down
      this.autocompleteSelectionIdx++;
    } else if (event.keyCode === 38 && this.autocompleteSelectionIdx >= 0) {
      // Arrow Up
      this.autocompleteSelectionIdx--;
    }

    if (this.autocompleteSelectionIdx === -1) {
      (document.getElementById('labelInputField') as HTMLElement).focus();
    } else {
      (suggestions[this.autocompleteSelectionIdx] as HTMLElement).focus();
    }
  }

  addLabel(title) {
    if (title.length === 0) {
      this.toastCtrl.create({
        message: 'Please enter a label and press enter to label this recipe.',
        duration: 6000
      }).present();
      return;
    }

    var me = this;

    var loading = this.loadingService.start();

    this.labelService.create({
      recipeId: this.recipe.id,
      title: title.toLowerCase()
    }).subscribe(function(response) {
      loading.dismiss();

      // if (!me.recipe.labels) me.recipe.labels = [];
      // if (me.recipe.labels.findIndex(function(el) { return el.id === response.id }) === -1) me.recipe.labels.push(response);
      // if (me.selectedLabels.indexOf(response.title) === -1) me.selectedLabels.push(response.title);

      // me.labelObjectsByTitle[response.title] = response;

      me.loadLabels().then(function() {
        me.toggleAutocomplete(false);
        me.pendingLabel = '';
      });
    }, function(err) {
      loading.dismiss();
      switch(err.status) {
        case 0:
          me.toastCtrl.create({
            message: me.utilService.standardMessages.offlinePushMessage,
            duration: 5000
          }).present();
          break;
        case 401:
          me.toastCtrl.create({
            message: me.utilService.standardMessages.unauthorized,
            duration: 6000
          }).present();
          break;
        case 404:
          me.toastCtrl.create({
            message: 'Can\'t find the recipe you\'re trying to add a label to. Please try again or reload this recipe page.',
            duration: 6000
          }).present();
          break;
        default:
          me.toastCtrl.create({
            message: me.utilService.standardMessages.unexpectedError,
            duration: 6000
          }).present();
          break;
      }
    });
  }

  deleteLabel(label) {
    let alert = this.alertCtrl.create({
      title: 'Confirm Label Removal',
      message: 'This will remove the label "' + label.title + '" from this recipe.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          handler: () => {
            // this.selectedLabels.push(label.title);
          }
        },
        {
          text: 'Remove',
          handler: () => {
            this._deleteLabel(label);
          }
        }
      ]
    });
    alert.present();
  }

  private _deleteLabel(label) {
    var me = this;

    var loading = this.loadingService.start();

    label.recipeId = this.recipe.id;

    this.labelService.remove(label).subscribe(function() {
      loading.dismiss();

      if(label.recipes.length === 1) {
        var i = me.existingLabels.indexOf(label.title);
        me.existingLabels.splice(i, 1);
        delete me.labelObjectsByTitle[label.title];
      } else {
        var recipeIdx = label.recipes.findIndex(function(el) {
          return el.id === me.recipe.id;
        });
        label.recipes.splice(recipeIdx, 1);
      }

      var lblIdx = me.recipe.labels.findIndex(function(el) {
        return el.id === label.id;
      });
      me.recipe.labels.splice(lblIdx, 1);

      var idx = me.selectedLabels.indexOf(label.title);
      me.selectedLabels.splice(idx, 1);
    }, function(err) {
      loading.dismiss();
      switch(err.status) {
        case 0:
          me.toastCtrl.create({
            message: me.utilService.standardMessages.offlinePushMessage,
            duration: 5000
          }).present();
          break;
        case 404:
          me.toastCtrl.create({
            message: 'Can\'t find the recipe you\'re trying to delete a label from. Please try again or reload this recipe page.',
            duration: 6000
          }).present();
          break;
        default:
          me.toastCtrl.create({
            message: me.utilService.standardMessages.unexpectedError,
            duration: 6000
          }).present();
          break;
      }
    });
  }

  prettyDateTime(datetime) {
    if (!datetime) return '';
    return this.utilService.formatDate(datetime, { times: true });
  }
}
