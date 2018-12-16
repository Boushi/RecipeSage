import { Component } from '@angular/core';
import { Events, IonicPage, NavController, NavParams, AlertController, ToastController, PopoverController } from 'ionic-angular';

import { RecipeServiceProvider, Recipe } from '../../providers/recipe-service/recipe-service';
import { MessagingServiceProvider } from '../../providers/messaging-service/messaging-service';
import { UserServiceProvider } from '../../providers/user-service/user-service';
import { LoadingServiceProvider } from '../../providers/loading-service/loading-service';
import { WebsocketServiceProvider } from '../../providers/websocket-service/websocket-service';
import { UtilServiceProvider } from '../../providers/util-service/util-service';

@IonicPage({
  segment: 'list/:folder',
  priority: 'high',
})
@Component({
  selector: 'page-home',
  templateUrl: 'home.html'
})
export class HomePage {

  recipes: Recipe[];
  initialLoadComplete: boolean = false;

  searchText: string;

  folder: string;
  folderTitle: string;

  viewOptions: any = {};
  filterOptions: any = {};

  searchWorker: any;

  constructor(
    public navCtrl: NavController,
    public navParams: NavParams,
    public events: Events,
    public popoverCtrl: PopoverController,
    public loadingService: LoadingServiceProvider,
    public alertCtrl: AlertController,
    public toastCtrl: ToastController,
    public recipeService: RecipeServiceProvider,
    public userService: UserServiceProvider,
    public utilService: UtilServiceProvider,
    public websocketService: WebsocketServiceProvider,
    public messagingService: MessagingServiceProvider) {

    this.folder = navParams.get('folder') || 'main';
    switch(this.folder) {
      case 'inbox':
        this.folderTitle = 'Inbox';
        break;
      default:
        this.folderTitle = 'My Recipes';
        break;
    }

    this.loadViewOptions();
    this.filterOptions.viewOptions = this.viewOptions;

    this.websocketService.register('messages:new', payload => {
      if (payload.recipe && this.folder === 'inbox') {
        this.loadRecipes();
      }
    }, this);

    events.subscribe('import:pepperplate:complete', () => {
      this.loadRecipes();
    });

    this.searchText = '';
  }

  ionViewWillEnter() {
    var loading = this.loadingService.start();

    this.loadRecipes().then(() => {
      this.initialLoadComplete = true;
      loading.dismiss();
    }, () => {
      loading.dismiss();
    });
  }

  refresh(refresher) {
    this.loadRecipes().then(() => {
      refresher.complete();
    }, () => {
      refresher.complete();
    });
  }

  loadViewOptions() {
    var defaults = {
      showLabels: true,
      showImages: true,
      showSource: false,
      sortBy: '-title',
      selectedLabels: [],
    }

    this.viewOptions.showLabels = JSON.parse(localStorage.getItem('showLabels'));
    this.viewOptions.showImages = JSON.parse(localStorage.getItem('showImages'));
    this.viewOptions.showSource = JSON.parse(localStorage.getItem('showSource'));
    this.viewOptions.sortBy = localStorage.getItem('sortBy');
    this.viewOptions.selectedLabels = [];

    for (var key in this.viewOptions) {
      if (this.viewOptions.hasOwnProperty(key)) {
        if (this.viewOptions[key] == null) {
          this.viewOptions[key] = defaults[key];
        }
      }
    }
  }

  loadRecipes() {
    return new Promise((resolve, reject) => {
      this.recipeService.fetch({
        folder: this.folder,
        sortBy: this.viewOptions.sortBy,
        // labels: this.viewOptions.selectedLabels
      }).subscribe(response => {

        if (this.searchWorker) this.searchWorker.terminate();
        this.searchWorker = new Worker('assets/src/search-worker.js');

        this.searchWorker.postMessage(JSON.stringify({
          op: 'init',
          data: response
        }));

        this.searchWorker.onmessage = e => {
          var message = JSON.parse(e.data);
          if (message.op === 'results') {
            this.recipes = message.data;
          }
        }

        if (this.searchText) {
          this.search(this.searchText);
        } else {
          this.recipes = response;
        }

        resolve();
      }, err => {
        reject();

        switch(err.status) {
          case 0:
            let offlineToast = this.toastCtrl.create({
              message: this.utilService.standardMessages.offlineFetchMessage,
              duration: 5000
            });
            offlineToast.present();
            break;
          case 401:
            this.navCtrl.setRoot('LoginPage', {}, {animate: true, direction: 'forward'});
            break;
          default:
            let errorToast = this.toastCtrl.create({
              message: this.utilService.standardMessages.unexpectedError,
              duration: 30000
            });
            errorToast.present();
            break;
        }
      });
    });
  }

  openRecipe(recipe) {
    console.log(recipe)
    // this.navCtrl.setRoot(RecipePage, {}, {animate: true, direction: 'forward'});
    this.navCtrl.push('RecipePage', {
      recipe: recipe,
      recipeId: recipe.id
    });
  }

  presentPopover(event) {
    let popover = this.popoverCtrl.create('HomePopoverPage', { viewOptions: this.viewOptions });

    popover.present({
      ev: event
    });
  }

  newRecipe() {
    this.navCtrl.push('EditRecipePage');
  }

  search(text) {
    if (!text) text = '';
    this.searchText = text;
    this.searchWorker.postMessage(JSON.stringify({
      op: 'search',
      data: text
    }));
  }

  trackByFn(index, item) {
    return item.id;
  }
}
