#!/bin/bash

cd Frontend

npm run dist

if [ $? -eq 0 ]; then
    echo OK
    
    ssh julian@recipesage.com 'cd /var/www/recipesage.com; rm -rf ./*; cd ~/Projects/chefbook; git checkout Backend/package-lock.json; git pull; cd Backend; npm install; pm2 reload RecipeSageAPI'

    scp -r ./www/* julian@recipesage.com:/var/www/recipesage.com
else
    echo FAIL
fi
