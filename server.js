const PORT = process.env.PORT || 5000;

var express = require("express");
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var cors = require('cors');
var morgan = require('morgan');
const mongoose = require('mongoose');
var bcrypt = require("bcrypt-inzi");
var jwt = require('jsonwebtoken');
var path = require('path');
const favicons = require('favicons');

var SERVER_SECRET = process.env.SECRET || "1234";
/////////////////////////////////////////////////////////////////////////
let dbURI = "mongodb+srv://root:root@cluster0.cnbo3.mongodb.net/testdb?retryWrites=true&w=majority";
// let dbURI = 'mongodb://localhost:27017/abc-database';
mongoose.connect(dbURI, { useNewUrlParser: true, useUnifiedTopology: true });

//https://mongoosejs.com/docs/connections.html#connection-events
////////////////mongodb connected disconnected events///////////////////////////////////////////////
mongoose.connection.on('connected', function () { //connected
    console.log("Mongoose in connected");
});

mongoose.connection.on('disconnected', function () { //disconnected
    console.log("Mongoose is disconnected");
    process.exit(1);
});

mongoose.connection.on('error', function (err) { //any error
    console.log("Mongoose connection error: ", err);
    process.exit(1);
})

process.on('SIGINT', function () {//this function will run jst before app is closing
    console.log("App is terminating");
    mongoose.connection.close(function () {
        console.log("Mongoose default connection closed");
        process.exit(0);
    });
});

////////////////mongodb connected disconnected events///////////////////////////////////////////////
var userSchema = new mongoose.Schema({
    "name": String,
    "email": String,
    "password": String,
    "phone": String,
    "gender": String,
    "createdOn": { "type": Date, "default": Date.now },
    "activeSince": Date
});

var userModel = mongoose.model("users", userSchema);

var app = express();
app.use(bodyParser.json());
app.use(cookieParser());
app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(morgan('dev'));
app.use("/", express.static(path.resolve(path.join(__dirname, "frontend"))));

app.post("/signup", (req, res, next) => {
    if (!req.body.name || !req.body.email || !req.body.password || !req.body.phone || !req.body.gender) {
        res.status(403).send(`
            please send name, email, passwod, phone and gender in json body.
            e.g:
            {
                "name": "abdul",
                "email": "abdul@gmail.com",
                "password": "abc",
                "phone": "03001234567",
                "gender": "Male"
            }`);
        return;
    }
    userModel.findOne({ email: req.body.email }, function (err, doc) {
        if (!err && !doc) {
            bcrypt.stringToHash(req.body.password).then(function (hash) {
                var newUser = new userModel({
                    "name": req.body.name,
                    "email": req.body.email,
                    "password": hash,
                    "phone": req.body.phone,
                    "gender": req.body.gender,
                });
                newUser.save((err, data) => {
                    // console.log(data);
                    if (!err) {
                        res.send({
                            message: "Signup Successfuly",
                            status: 200,
                            data: data
                        });
                    }
                    else {
                        console.log(err);
                        res.status(500).send({
                            message: "User create error, " + err
                        });
                    }
                });
            });
        }
        else if (err) {
            res.send({
                message: "DB Error" + err,
                status: 500
            });
        }
        else {
            res.send({
                message: "User already exist!",
                status: 409
            });
        }
    })
});

app.post("/login", (req, res, next) => {
    if (!req.body.email || !req.body.password) {
        res.send(`
            please send email and passwod in json body.
            e.g:
            {
                "email": "abdul@gmail.com",
                "password": "abc",
            }`)
        // return;
    }

    userModel.findOne({ email: req.body.email }, function (err, data) {
        if (err) {
            console.log(err);
            res.status(500).send({
                message: "An error occured: " + JSON.stringify(err)
            });
        }
        else if (data) {
            console.log(req.body.email);
            bcrypt.varifyHash(req.body.password, data.password).then(isMatched => {
                if (isMatched) {
                    console.log("Matched");

                    let tocken = jwt.sign({
                        id: data._id,
                        name: data.name,
                        email: data.email,
                        phone: data.phone,
                        gender: data.gender,
                        // ip: req.connection.remoteAddress
                    }, SERVER_SECRET)

                    res.cookie('jTocken', tocken, {
                        maxAge: 86_400_000,
                        httpOnly: true
                    });

                    res.send({
                        message: "Login Success",
                        user: {
                            name: data.name,
                            email: data.email,
                            phone: data.phone,
                            gender: data.gender,
                        },
                    });
                }
                else {
                    console.log("Password not matched");
                    res.send({
                        message: "Incorrect Password",
                        status: 409
                    });
                }
            }).catch(e => {
                console.log("Error: ", e)
            });
        }
        else {
            res.send({
                message: "User not found",
                status: 403
            });
        }
    });
});

app.use(function (req, res, next) {
    console.log("req.cookies: ", req.cookies);
    if (!req.cookies.jTocken) {
        res.status(401).send("include http-only credentials with every request")
        return;
    }
    jwt.verify(req.cookies.jTocken, SERVER_SECRET, function (err, decodeData) {
        if (!err) {
            const issueDate = decodeData.iat * 1000;
            const nowDate = new Date().getTime();
            const diff = nowDate - issueDate; //86400,000

            if (diff > 300000) {//// expire after 5 min (in milis)
                res.status(401).send("Tocken Expired")
            }
            else { //issue new tocken
                var tocken = jwt.sign({
                    id: decodeData.id,
                    name: decodeData.name,
                    email: decodeData.email,
                }, SERVER_SECRET)
                res.cookie('jTocken', tocken, {
                    maxAge: 86_400_000,
                    httpOnly: true
                });
                req.body.jTocken = decodeData
                next();
            }
        }
        else {
            res.status(401).send("invalid token")
        }
    });
});

app.get("/profile", (req, res, next) => {
    console.log(req.body);

    userModel.findById(req.body.jTocken.id, 'name email phone gender createdOn',
        function (err, doc) {
            if (!err) {
                res.send({
                    profile: doc
                });
            }
            else {
                res.send({
                    message: "Server error",
                    status: 500
                });
            }
        });
});

app.post("/logout", (req, res, next) => {
    res.cookie('jTocken', "", {
        maxAge: 86_400_000,
        httpOnly: true
    });
    res.send("Logout Success");
})

app.listen(PORT, () => {
    console.log("server is running on: ", PORT);
});