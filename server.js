const express = require('express');
const app = express();
const server = require('http').createServer(app);
const port = process.env.PORT;

server.listen(port, function(){
  console.log(`Server running on port: ${port}`);
});

//Dotenv.config
require('dotenv').config()

//Connection to Binance
const api = require('binance');
const binanceWS = new api.BinanceWS(true);
const binanceRest = new api.BinanceRest({
  timeout: 15000, // Optional, defaults to 15000, is the request time out in milliseconds
  recvWindow: 5000, // Optional, defaults to 5000, increase if you're getting timestamp errors
  disableBeautification: false,
  handleDrift: false,
  baseUrl: 'https://api.binance.com/',
  requestOptions: {}
});
const streams = binanceWS.streams;

//Connection to Telegram
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_TOKEN;
const chat_id = process.env.TELEGRAM_CHAT_ID;
const bot = new TelegramBot(token, {polling: true});

//Get prices of all pairs from Binance
binanceRest.allPrices()
  .then(data => {pushEachPairToArray(data)})
  .catch(err => {console.error(err)})

//Group all pairs by market
let btcPairs = [];
let ethPairs = [];
let bnbPairs = [];
let trxPairs = [];
let xrpPairs = [];
let usdtPairs = [];
function pushEachPairToArray(data){
  console.log("Group by market")
  for(let i = 0; i < data.length; i++){
    if(data[i].symbol.slice(-3) === 'BTC') {
      btcPairs.push(data[i].symbol);
    }else if(data[i].symbol.slice(-3) === 'ETH') {
      ethPairs.push(data[i].symbol);
    }else if(data[i].symbol.slice(-3) === 'BNB') {
      bnbPairs.push(data[i].symbol);
    }else if(data[i].symbol.slice(-3) === 'TRX') {
      trxPairs.push(data[i].symbol);
    }else if(data[i].symbol.slice(-3) === 'XRP') {
      xrpPairs.push(data[i].symbol);
    }else if(data[i].symbol.slice(-4) === 'USDT') {
      usdtPairs.push(data[i].symbol);
    }
  }
  getKlines()
  setInterval(getKlines, 500000)
}

//Request klines for choosen period
let firstRun = true
function getKlines(){
  console.log("Get klines")
  for(let i = 0; i < btcPairs.length; i++){
    binanceRest
      .klines({
        symbol: btcPairs[i],
        interval: "1d",
        limit: 7
      })
      .then(data => {
        data.forEach(day => {day['symbol'] = btcPairs[i]})
        createCustomObject(data)
      })
      .catch(err => {console.error(err)});
  }
}

//Create custom object
let tradeStream
let tickerStream
let btcStreams = []
let obj
let customObjectArray = []
function createCustomObject(data) {

  let weekVolumeQuote = 0;
  let weekVolume = 0;
  let weekTakerVolumeQuote = 0;
  let weekAverage = 0;
  let coeficient = 0;
  let balance = 0;

  for(let i = 0; i < data.length; i++) {
    let symbol = data[i].symbol
    weekVolumeQuote += parseFloat(data[i].quoteAssetVolume)
    weekVolume += parseFloat(data[i].volume)
    weekTakerVolumeQuote += parseFloat(data[i].takerQuoteAssetVolume)
    weekAverage = weekVolumeQuote / weekVolume
    coeficient = weekVolumeQuote / 672
    balance = weekTakerVolumeQuote - (weekVolumeQuote - weekTakerVolumeQuote)
    tradeStream = streams.trade(symbol)
    tickerStream = streams.ticker(symbol)
    obj = {'symbol': symbol,
          'coeficient': coeficient,
          'tradeStream': tradeStream,
          'tickerStream': tickerStream,
          'weekVolumeQuote': weekVolumeQuote.toFixed(2),
          'weekAverage': weekAverage.toFixed(8),
          'balance': balance.toFixed(2)
          }
  }
  firstTimeRun()
}

//Check if code running first time or not
let startStreamDone = false
function firstTimeRun(){
  if(firstRun === true){
    customObjectArray.push(obj)
    btcStreams.push(tradeStream)
    btcStreams.push(tickerStream)
    if(startStreamDone === false){
      console.log("First run")
      startStream()
    }
  }else{
    updateCustomObjectArray()
  }
}

//Update old array with new values
function updateCustomObjectArray(){
  customObjectArray.forEach(item => {
    if(item.symbol === obj.symbol){
      item = obj
    }
  })
}

//Start stream if data is ready
function startStream(){
  startStreamDone = true
  if(btcPairs.length === customObjectArray.length){
    console.log("Start websocket")
    getStreams()
  } else {
    console.log("Data not ready")
    setTimeout(() => {startStream()}, 500)
  }
}

//Icons for telegram message
const upGraph = String.fromCodePoint(0x1F4C8);
const downGraph = String.fromCodePoint(0x1F4C9);
const tick = String.fromCodePoint(0x2705);
const cross = String.fromCodePoint(0x274C);
const price = String.fromCodePoint(0x1F4B2);

//Get 24h stream and real time trades stream. Compare stream data with API data.
//Send signals to Telergam group
let tickerData
let tradeData
let total
let priceDifference
function getStreams(){
  console.log("Get stream")
  firstRun = false
  binanceWS.onCombinedStream(btcStreams, streamEvent => {
    for(let i = 0; i < customObjectArray.length; i++){
      if(streamEvent.stream === customObjectArray[i].tickerStream){
        tickerData = streamEvent.data
        if(tickerData.symbol === customObjectArray[i].symbol){
          customObjectArray[i]['dayVolume'] = parseFloat(tickerData.quoteAssetVolume)
                                                .toFixed(2)
        }
      }
      if(streamEvent.stream === customObjectArray[i].tradeStream){
        tradeData = streamEvent.data
        if(tradeData.symbol === customObjectArray[i].symbol){
          total = tradeData.price * tradeData.quantity
          priceDifference = (tradeData.price - customObjectArray[i].weekAverage)
                            / tradeData.price * 100
        }
        if(total > customObjectArray[i].coeficient && priceDifference <= 5){
          if(tradeData.maker === false){
            let buyMsgTemplate =
            `${upGraph} #${tradeData.symbol} ${tick}BUY\n`+
            `BTC: ${total.toFixed(2)}\n`+
            `${price}Price: ${tradeData.price}\n`+
            `${priceDifference.toFixed(2)}% of ${customObjectArray[i].weekAverage}\n`+
            `Volume(24h): ${customObjectArray[i].dayVolume} BTC\n`+
            `Balance(7d): ${customObjectArray[i].balance} BTC`
            bot.sendMessage(chat_id, buyMsgTemplate);
          }else if(tradeData.maker === true){
            let sellMsgTemplate =
            `${downGraph} #${tradeData.symbol} ${cross}SELL\n`+
            `BTC: ${total.toFixed(2)}\n`+
            `${price}Price: ${tradeData.price}\n`+
            `${priceDifference.toFixed(2)}% of ${customObjectArray[i].weekAverage}\n`+
            `Volume(24h): ${customObjectArray[i].dayVolume} BTC\n`+
            `Balance(7d): ${customObjectArray[i].balance} BTC`
            bot.sendMessage(chat_id, sellMsgTemplate);
          }
        }
      }
    }
  });
}