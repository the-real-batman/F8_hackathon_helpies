var express = require("express");
var request = require("request");
var bodyParser = require("body-parser");
const {Wit, log} = require('node-wit');
// firebase client
var firebaseClient = require('./firebaseClient')

const client = new Wit({
  accessToken: process.env.WIT_TOKEN,
  logger: new log.Logger(log.DEBUG) // optional
});

const safe = (f, def) => {
  let res = def
  try { res = f() } catch (e) { /* ignore */ }
  return res
}

var app = express();
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.listen((process.env.PORT || 5000));

// Server index page
app.get("/", function (req, res) {
  res.send("Deployed!");
});

// Facebook Webhook
// Used for verification
app.get("/webhook", function (req, res) {
  if (req.query["hub.verify_token"] === "this_is_my_token") {
    console.log("Verified webhook");
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    console.error("Verification failed. The tokens do not match.");
    res.sendStatus(403);
  }
});

// All callbacks for Messenger will be POST-ed here
app.post("/webhook", function (req, res) {
  // Make sure this is a page subscription
  console.log("debug:", req.body);
  if (req.body.object == "page") {
    // Iterate over each entry
    // There may be multiple entries if batched
    req.body.entry.forEach(function(entry) {
      // Iterate over each messaging event
      entry.messaging.forEach(function(event) {
        console.log("debug:", event)
        if (event.postback) {
          processPostback(event);
        } else {
          messageHandle(event)
        }
      });
    });

    res.sendStatus(200);
  }
});

function processPostback(event) {
  var senderId = event.sender.id;
  var payload = event.postback.payload;

  if (payload === "Greeting") {
    // Get user's first name from the User Profile API
    // and include it in the greeting
    request({
      url: "https://graph.facebook.com/v2.6/" + senderId,
      qs: {
        access_token: process.env.PAGE_ACCESS_TOKEN,
        fields: "first_name"
      },
      method: "GET"
    }, (error, response, body) => {
      var greeting = "";
      if (error) {
        console.log("Error getting user's name: " +  error);
      } else {
        var bodyObj = JSON.parse(body);
        name = bodyObj.first_name;
        greeting = "Hi " + name + ". ";
      }
      var message = greeting + "My name is Helpies Bot. We are matching volonteers and organizers";
      // create user in firebase:
      firebaseClient.createUsers({userId: senderId, name})
      sendMessage(senderId, {text: message}).then(_ => {
        // questions 0
        sendMessageZero(senderId)
      })
    });
    firebaseClient.setUserBotQuestionsNb({userId: senderId, nbQuestions: 0})
  }
}
const sendMessageZero = senderId => {
  return sendQuickReplyMessage({
    recipientId: senderId,
    text: "Are you a volonteer or an organizer ?",
    messages: ["volonteer", "organizer"],
  })
}

const sendMessageOne = senderId => {
  return sendMessage(senderId, {text: "What is your city ?"})
}

const messageHandle = (event) => {
  // get userBotNbQuestions
  console.log("PAYLOAD LOG", event);
  const senderId = safe(() => event.sender.id)
  if (!senderId) {
    return
  }

  firebaseClient.getUserBotQuestionsNb({userId: senderId}).then(nb => {
    console.log(`handle bot question for user: ${senderId}`);
    if (nb === 0) {
      const message = safe(() => event.message.quick_reply.payload)
      if (message !== "volonteer" && message!== "organizer") {
        // sendMessageZero(senderId)
      } else {
        console.log("handler answer 1");
        firebaseClient.addRoleToUser({userId: senderId, role: message})
        firebaseClient.setUserBotQuestionsNb({userId: senderId, nbQuestions: 1})
        sendMessageOne(senderId)
      }
    } else if (nb === 1) {
      const message = safe(() => event.message)
      console.log(message);
      // getLocationFromUserMessage()
      // console.log("handler answer 2");
      // firebaseClient.setUserBotQuestionsNb({userId: senderId, nbQuestions: 2})
    }
  })
  // console.log(message);
  // firebaseClient.getUserBotQuestionsNb({userId: senderId}).then(nb => {
  //   if (nb === 0) {
  //     console.log("handler answer 1");
  //     firebaseClient.setUserBotQuestionsNb({userId: senderId, nbQuestions: 1})
  //   } else if (nb === 1) {
  //     console.log("handler answer 2");
  //     firebaseClient.setUserBotQuestionsNb({userId: senderId, nbQuestions: 2})
  //     return
  //   }
  // })
  // if case
}

// sends message to user
function sendMessage(recipientId, message) {
  return new Promise((resolve, reject) => {
    request({
      url: "https://graph.facebook.com/v2.6/me/messages",
      qs: {access_token: process.env.PAGE_ACCESS_TOKEN},
      method: "POST",
      json: {
        recipient: {id: recipientId},
        message: message,
      }
    }, (error, response, body) => {
      if (error) {
        console.log("Error sending message: " + response.error);
        reject()
      }
      resolve()
    });
  });
}

const sendQuickReplyMessage = ({recipientId, text = "", messages = [], questionNb = 0}) => {
  return new Promise((resolve, reject) => {
    console.log("will try to send quick reply Message");
    request({
      url: "https://graph.facebook.com/v2.6/me/messages",
      qs: {access_token: process.env.PAGE_ACCESS_TOKEN},
      method: "POST",
      json: {
        recipient: {"id": recipientId},
        "message":{
          "text": text,
          "quick_replies": messages.map(t => ({
            "content_type": "text",
            "title": t,
            "payload": t,
            // "image_url":"http://example.com/img/red.png"
          })),
        }
      }
    }, (error, response, body) => {
      if (error) {
        console.log("Error sending message: " + response.error);
        reject()
      }
      resolve()
    });
  });
}

// helper function to get user location from message
const getLocationFromUserMessage = message => {
  return new Promise(function(resolve, reject) {
    client.message(message, {})
    .then((data) => {
      // TODO: Get the best confidence instead of first value
      const location = safe(_ => data.entities.location[0].value, "")
      console.log(`message: ${message} location: ${location}`);
      resolve(location)
    })
    .catch(console.error);
  });
}
// example of how to use getLocationFromUserMessage
// getLocationFromUserMessage("I am from seoul").then(location => console.log(location))


// helper function to get user keyword
// return array of keyword
const getKeyWordsFromUserMessage = message => {
  return new Promise(function(resolve, reject) {
    client.message(message, {})
    .then((data) => {
      // TODO: Get the best confidence instead of first value
      const keywords = safe(_ => data.entities.needs.map(({value}) => value), "")
      resolve(keywords)
    })
    .catch(console.error);
  });
}
// example of how to use getLocationFromUserMessage
// getKeyWordsFromUserMessage("I need a webapp").then(keywords => console.log(keywords))

// example to create user
// firebaseClient.createUsers({userId: "idFromFacebookTest", name: "test"})
// firebaseClient.addLocationToUser({userId: "idFromFacebookTest", location: "seoul"})
// firebaseClient.addUserExperiences({userId: "idFromFacebookTest", experiences: ["webapp", "yolo"]})
// firebaseClient.needs({userId: "idFromFacebookTest", needs: ["app"]})
// firebaseClient.getUserBotQuestionsNb({userId: 1634780963305366}).then(nb => console.log(nb))
