import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, isSupported, Messaging, onMessage } from 'firebase/messaging';

import { Injectable } from '@angular/core';

import { ToastController, AlertController } from '@ionic/angular';

import { UserService } from './user.service';
import { UtilService } from './util.service';
import { HttpService } from './http.service';
import { EventService } from './event.service';
import {ErrorHandlers} from './http-error-handler.service';

export interface Message {
  id: string,
  body: string,
  createdAt: string,
  updatedAt: string,
  fromUserId: string,
  toUserId: string,
  recipeId: string | null,
  originalRecipeId: string | null,

  recipe: null | {
    id: string,
    title: string,
    images: any[],
  },
  originalRecipe: null | {
    id: string,
    title: string,
    images: any[],
  },

  fromUser: {
    id: string,
    name: string,
    email: string,
  },
  toUser: {
    id: string,
    name: string,
    email: string,
  },
  otherUser: {
    id: string,
    name: string,
    email: string,
  }
}

export interface MessageThread {
  otherUser: {
    id: string,
    name: string,
    email: string,
  },
  messageCount: number,
  messages: Message[],
}

@Injectable({
  providedIn: 'root'
})
export class MessagingService {

  private messaging: Messaging;
  private fcmToken: any;

  constructor(
  public events: EventService,
  public utilService: UtilService,
  public httpService: HttpService,
  public userService: UserService,
  public alertCtrl: AlertController,
  public toastCtrl: ToastController) {

    const onSWRegsitration = async () => {
      const isFirebaseSupported = await isSupported();
      if (!isFirebaseSupported) return;

      console.log('Has service worker registration. Beginning setup.');
      const config = {
        appId: '1:1064631313987:android:b6ca7a14265a6a01',
        apiKey: 'AIzaSyANy7PbiPae7dmi4yYockrlvQz3tEEIkL0',
        projectId: 'chef-book',
        messagingSenderId: '1064631313987'
      };
      const app = initializeApp(config);

      this.messaging = getMessaging(app);

      onMessage(this.messaging, (message) => {
        console.log('received foreground FCM: ', message);
        // TODO: REPLACE WITH GRIP (WS)
        switch (message.data.type) {
          case 'import:pepperplate:complete':
            return this.events.publish('import:pepperplate:complete');
          case 'import:pepperplate:failed':
            return this.events.publish('import:pepperplate:failed', message.data.reason);
          case 'import:pepperplate:working':
            return this.events.publish('import:pepperplate:working');
        }
      });
    };
    if ((window as any).swRegistration) onSWRegsitration.call(null);
    else (window as any).onSWRegistration = onSWRegsitration;
  }

  isNotificationsEnabled() {
    return isSupported() && ('Notification' in window) && ((Notification as any).permission === 'granted');
  }

  isNotificationsCapable() {
    return isSupported();
  }

  fetch(params: {
    user: string,
  }, errorHandlers?: ErrorHandlers) {
    return this.httpService.requestWithWrapper<Message[]>(
      `messages`,
      'GET',
      null,
      params,
      errorHandlers
    );
  }

  threads(params?: {
    limit?: number,
  }, errorHandlers?: ErrorHandlers) {
    return this.httpService.requestWithWrapper<MessageThread[]>(
      `messages/threads`,
      'GET',
      null,
      params,
      errorHandlers
    );
  }

  create(payload: {
    body: string,
    to: string,
    recipeId?: string,
  }, errorHandlers?: ErrorHandlers) {
    return this.httpService.requestWithWrapper<void>(
      `messages`,
      'POST',
      payload,
      null,
      errorHandlers
    );
  }

  async requestNotifications() {
    if (!isSupported()) return;
    if (!('Notification' in window)) return;
    if (!this.messaging || (Notification as any).permission === 'denied') return;

    // Skip the prompt if permissions are already granted
    if ((Notification as any).permission === 'granted') {
      this.enableNotifications();
      return;
    }

    if (!localStorage.getItem('notificationExplainationShown')) {
      localStorage.setItem('notificationExplainationShown', 'true');

      const alert = await this.alertCtrl.create({
        header: 'Requires Notification Permissions',
        message: `To notify you when your contacts send you messages, we need notification access.<br /><br />
                    <b>After dismissing this popup, you will be prompted to enable notification access.</b>`,
        buttons: [
          {
            text: 'Cancel'
          },
          {
            text: 'Continue',
            handler: () => {
              this.enableNotifications();
            }
          }
        ]
      });
      alert.present();
    } else {
      this.enableNotifications();
    }
  }

  // Grab token and setup FCM
  private async enableNotifications() {
    const isFirebaseSupported = await isSupported();
    if (!this.messaging || !isFirebaseSupported) return;

    console.log('Requesting permission...');
    const result = await Notification.requestPermission();

    if (result === 'granted') this.updateToken();
    return this.updateToken();
  }

  public async disableNotifications() {
    const isFirebaseSupported = await isSupported();
    if (!this.messaging || !isFirebaseSupported) return;

    const token = this.fcmToken;

    await this.userService.removeFCMToken(token);
  }

  private async updateToken() {
    const isFirebaseSupported = await isSupported();
    if (!this.messaging || !isFirebaseSupported) return;

    try {
      const currentToken = await getToken(this.messaging, {
        serviceWorkerRegistration: (window as any).swRegistration,
      });
      if (!currentToken) return;

      this.fcmToken = currentToken;

      await this.userService.saveFCMToken({
        fcmToken: currentToken
      });
    } catch(err) {
      console.log('Unable to get notification token. ', err);
    }
  }
}
