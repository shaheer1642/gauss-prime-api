const admin = require("firebase-admin");
const {initializeApp} = require('firebase-admin/app');
const {getMessaging} = require('firebase-admin/messaging');

const firebaseApp = initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CREDENTIAL))
}, 'GaussPrime');
const messaging = getMessaging(firebaseApp);

function pushNotify({topic, title , body}) {
    messaging.send({
        token: '',
        notification: {
            title: title,
            body: body
        },
    }).then((response) => {
        console.log('[firebase/FCM] Successfully sent message:', response);
    }).catch((error) => {
        console.log('[firebase/FCM] Error sending message:', error);
    });
}