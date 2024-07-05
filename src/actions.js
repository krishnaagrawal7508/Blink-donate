// import modules
import { Connection, Transaction, Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import * as splToken from "@solana/spl-token";
import fs from 'fs';
import mcbuild from './mcbuild.js';
import open from 'open';
import http from 'http';
import https from 'https';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';

let port = 3001; // try 8444 for prod
const server_host = "https://blink-donate.vercel.app/"; // https fqd required for prod
const auto_open = "donate-usdc-config"; // dial.to dev test window : set false for prod


// configures express web server 

const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: true }));

let protocol;
let http_port = ":" + port;
let proto;
if (server_host.includes("https:")) {
  protocol = https;
  proto = "https";
}
else {
  protocol = http;
  proto = "http";
}


app.use(function (req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Encoding, Accept-Encoding');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Content-Encoding', 'compress');
  res.setHeader('Content-Type', 'application/json');
  next();
});

// usdc donation default
app.get('/donate-usdc-config/', (req, res) => {
  let name = "donate-usdc";
  let obj = {}
  obj.icon = "https://miro.medium.com/v2/resize:fit:400/1*MgGIm08OdUTUvgNyaUl0hw.jpeg";
  obj.title = "Donate USDC";
  obj.description = "Enter USDC amount and click Send";
  obj.label = "donate";
  obj.links = {
    "actions": [
      {
        "label": "Send",
        "href": server_host + http_port + "/donate-usdc-build/",
        "parameters": [
          {
            "name": "amount",
            "label": "USDC Amount",
          }
        ]
      }
    ]
  }
  res.send(JSON.stringify(obj));
});

// usdc donation blink config
app.get('/donate-usdc-config/:address', (req, res) => {
  let name = "donate-usdc";
  let obj = {}
  let address = req.params.address;
  
  obj.icon = "https://miro.medium.com/v2/resize:fit:400/1*MgGIm08OdUTUvgNyaUl0hw.jpeg";
  obj.title = "Donate USDC";
  obj.description = "Enter USDC amount and click Send";
  obj.label = "donate";
  obj.links = {
    "actions": [
      {
        "label": "Send",
        "href": server_host + http_port + "/donate-usdc-build/" + address + "?amount={amount}",
        "parameters": [
          {
            "name": "amount",
            "label": "USDC Amount",
          }
        ]
      }
    ]
  }
  res.send(JSON.stringify(obj));
});

// usdc donation build tx 
app.route('/donate-usdc-build/:address').post(async function (req, res) {

  let err = {};
  if (typeof req.body.account == "undefined") {
    err.transaction = "error";
    err.message = "action did not receive an account";
    res.send(JSON.stringify(err));
  }

  // verify amount param was passed
  if (typeof req.query.amount == "undefined") {
    err.transaction = "error";
    err.message = "action did not receive an amount to send";
    res.send(JSON.stringify(err));
  }

  // action settings
  const decimals = 6; // usdc has 6 decimals
  const MINT_ADDRESS = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // usdc mint address
  const TO_WALLET = new PublicKey(req.params.address); // treasury wallet

  // connect : convert value to fractional units
  const SOLANA_CONNECTION = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const FROM_WALLET = new PublicKey(req.body.account);
  let amount = parseFloat(req.query.amount);
  amount = amount.toFixed(decimals);
  const TRANSFER_AMOUNT = amount * Math.pow(10, decimals);

  // usdc token account of sender
  let fromTokenAccount = await splToken.getAssociatedTokenAddress(
    MINT_ADDRESS,
    FROM_WALLET,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // check if the recipient wallet is oncurve
  let oncurve = true;
  if (PublicKey.isOnCurve(TO_WALLET.toString())) { oncurve = false; }
  console.log("oncurve:", oncurve);

  // usdc token account of recipient
  let toTokenAccount = null;
  toTokenAccount = await splToken.getAssociatedTokenAddress(
    MINT_ADDRESS,
    TO_WALLET,
    oncurve,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // check if the recipient wallet needs a usdc ata
  let createATA = false;
  await splToken.getAccount(SOLANA_CONNECTION, toTokenAccount, 'confirmed', splToken.TOKEN_PROGRAM_ID)
    .then(function (response) { createATA = false; })
    .catch(function (error) {
      if (error.name == "TokenAccountNotFoundError") { createATA = true }
      else { return; }
    });

  // create new instructions array
  let instructions = [];

  // create and add recipient ata instructions to array if needed
  if (createATA === true) {
    let createATAiX = new splToken.createAssociatedTokenAccountInstruction(
      FROM_WALLET,
      toTokenAccount,
      TO_WALLET,
      MINT_ADDRESS,
      splToken.TOKEN_PROGRAM_ID,
      splToken.ASSOCIATED_TOKEN_PROGRAM_ID
    );
    instructions.push(createATAiX);
  }

  // create and add the usdc transfer instructions
  let transferInstruction = splToken.createTransferInstruction(fromTokenAccount, toTokenAccount, FROM_WALLET, TRANSFER_AMOUNT);
  instructions.push(transferInstruction);

  // build transaction
  let _tx_ = {};
  _tx_.rpc = "https://api.mainnet-beta.solana.com";
  _tx_.account = req.body.account;
  _tx_.instructions = instructions;
  _tx_.signers = false;
  _tx_.serialize = true;
  _tx_.encode = true;
  _tx_.table = false;
  _tx_.tolerance = 1.2;
  _tx_.compute = false;
  _tx_.fees = false;
  _tx_.priority = req.query.priority;
  let tx = await mcbuild.tx(_tx_);
  console.log(tx);
  res.send(JSON.stringify(tx));

});

app.get("/actions.json", (req, res) => {
  if (server_host == "https://blink-donate.vercel.app/" && auto_open != false) {
    let rules = {
      "rules": [{
        "pathPattern": "/spl/*",
        "apiPath": server_host + http_port + "/" + auto_open
      }]
    };
    res.send(JSON.stringify(rules));
  }
});

app.get("/", (req, res) => {
  res.send(JSON.stringify('solana-action-express is running on ' + proto + http_port));
});

app.listen(port, () => {
  console.log('solana-action-express is running on ' + proto + http_port);
  console.log("server_host: ", server_host);
  console.log("auto_open: ", auto_open);
  // if (server_host == "http://https://blink-donate.vercel.app/" && auto_open != false) {
  //   let opening = "https://dial.to/?action=solana-action:https://blink-donate.vercel.app/" + http_port + "/" + auto_open;
  //   console.log("opening window: " + opening); open(opening);
  // }
});
