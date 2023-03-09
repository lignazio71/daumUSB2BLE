var EventEmitter = require('events').EventEmitter
var com = require('serialport')
var DaumSIM = require('./daumSIM')
const config = require('config-yml') // Use config for yaml config files in Node.js projects
var DEBUG = config.DEBUG.daumUSB // turn this on for debug information in console
const ByteLength = require('@serialport/parser-byte-length')
//const parser = require('@serialport/parser-byte-length')
// /////////////////////////////////////////////////////////////////////////
// instantiation
// /////////////////////////////////////////////////////////////////////////
var daumSIM = new DaumSIM()

function daumUSB () {
  var self = this
  self.port = null
  self.pending = [] // buffer for pushing pending commands to the port
  self.writer = null // used for flushing next pending data
  self.reader = null // used for 'runData' command
  self.readeradress = null // used for 'getAdress' command
  self.emitter = new EventEmitter()

  var daumCockpitAdress = config.daumCockpit.adress // this script is looking for the adress, this is working, for default, I'll set this to 00
  var gotAdressSuccess = config.daumCockpit.gotAdressSuccess // false by default to scan for cockpit adress; if adress cannot be retrieved, there will be no interaction with daum.
  // //////////////////////////////////////////////////////////////////////////
  // push data in queue befor flushNext is writing it to port
  // //////////////////////////////////////////////////////////////////////////
  this.write = function (string) {
    self.pending.push(string)
    if (DEBUG) console.log('[daumUSB.js] - this.write - [OUT]: ', string)
  }
  // //////////////////////////////////////////////////////////////////////////
  // send (flush) pending messages to port (sequencial)
  // //////////////////////////////////////////////////////////////////////////
  this.flushNext = function () {
    if (self.pending.length === 0) {
      if (DEBUG) console.log('[daumUSB.js] - this.flushNext - nothing pending')
      return
    }
    var string = self.pending.shift()
    if (self.port) {
      var buffer = new Buffer.from(string)
      if (DEBUG) console.log('[daumUSB.js] - flushNext - [OUT]: ', buffer)
      self.port.write(buffer)
    } else {
      if (DEBUG) console.log('[daumUSB.js] - flushNext - Communication port is not open - not sending data: ' + string)
    }
  }
  // //////////////////////////////////////////////////////////////////////////
  // used when port open to get data stream from buffer and grab the values, e.g. speed, rpm,...
  // //////////////////////////////////////////////////////////////////////////
  this.readAndDispatch = function (numbers) {
    if (DEBUG) console.log('[daumUSB.js] - readAndDispatch - [IN]: ', numbers)
    self.emitter.emit('raw', numbers)
    var states = numbers
    var statesLen = states.length
    if (gotAdressSuccess === false) { // this loop is for parsing the cockpit adress
      var i
      for (i = 0; i < statesLen; i++) {
        if (DEBUG) console.log('[daumUSB.js] - getAdress - [Index]: ', i, ' ', states[i])
        if (states[i].toString(16) === config.daumCommands.get_Adress) { // search for getAdress prefix
          var index = i
          if (DEBUG) console.log('[daumUSB.js] - getAdress - [Index]: ', index)
          daumCockpitAdress = (states[1 + index]).toString() // get the adress from the stream by using the index
          if (DEBUG) console.log('[daumUSB.js] - getAdress - [Adress]: ', daumCockpitAdress)
          self.emitter.emit('key', '[daumUSB.js] - getAdress - [Adress]: ' + daumCockpitAdress)
          clearInterval(self.readeradress) // stop looking for adress
          self.pending = [] // clear pending array
          gotAdressSuccess = true // adress is retrieved, lets set this to true to inform other functions that they can proceed now
          setTimeout(self.start, config.timeouts.start) // timeout is neccesarry to changes gears back to 1; there is an invalid value send, that sets gear 17 = 0x11, this should be filtered before data is read, but does not work
          if (DEBUG) console.log('[daumUSB.js] - getAdress - [gotAdressSuccess]: ', gotAdressSuccess)
          break // stop if prefix found and break
        }
      }
    } else {
      for (i = 0; i < (statesLen - 2); i++) { // this loop is for parsing the datastream after gotAdressSuccess is true and we can use the adress for commands
        if (states[i].toString(16) === config.daumCommands.run_Data && states[i + 1].toString(16) === daumCockpitAdress && states[i + 2] === 0) { // and search for the runData and daumCockpitAdress and manuall watt program prefix
          index = i
          if (DEBUG) console.log('[daumUSB.js] - runData - [Index]: ', index)
          break // stop if prefix found and break
        }
        if (i === statesLen - 3) {
          if (DEBUG) console.log('[daumUSB.js] - runData - [Index]: WRONG PROGRAM SET - SET MANUAL WATTPROGRAM 00')
          self.emitter.emit('error', '[daumUSB.js] - runData - [Index]: WRONG PROGRAM SET - SET MANUAL WATTPROGRAM 00')
        }
      }
    }
    var data = {}
    if (states.length >= 19 && gotAdressSuccess === true) { // gotAdressSuccess check to avoid invalid values 0x11 = 17 at startup; just check if stream is more than value, this is obsulete, because of custom parser that is parsing 40 bytes
      // var cadence = (states[6 + index])
      // if (!isNaN(cadence) && (cadence >= config.daumRanges.min_rpm && cadence <= config.daumRanges.max_rpm)) {
      //   data.cadence = cadence
      // }
      // var hr = 99 // !!! can be deleted - have to check BLE code on dependencies
      // if (!isNaN(hr)) { data.hr = hr } // !!! can be deleted - have to check BLE code on dependencies

      var rpm = (states[6 + index])
      if (!isNaN(rpm) && (rpm >= config.daumRanges.min_rpm && rpm <= config.daumRanges.max_rpm)) {
        data.rpm = rpm
        global.globalrpm_daum = data.rpm // global variables used, because I cannot code ;)
      }
      var gear = (states[16 + index])
      if (!isNaN(gear) && (gear >= config.daumRanges.min_gear && gear <= config.daumRanges.max_gear)) {
        if (gear > config.gpio.maxGear) { // beacause Daum has by default 28 gears, check and overwrite if gpio maxGear is lower
          gear = config.gpio.maxGear // ceiling the maxGear with parameter
          self.setGear(gear) // overwrite gear to Daum
        }
        data.gear = gear
        global.globalgear_daum = data.gear // global variables used, because I cannot code ;)
      }
      var program = (states[2 + index])
      if (!isNaN(program) && (program >= config.daumRanges.min_program && program <= config.daumRanges.max_program)) {
        data.program = program
      }
      if (rpm === 0) { // power -  25 watt will allways be transmitted by daum; set to 0 if rpm is 0 to avoid rolling if stand still in applications like zwift or fullgaz
        var power = 0
        data.power = power
      } else {
        power = (states[5 + index])
        if (!isNaN(power) && (power >= config.daumRanges.min_power && power <= config.daumRanges.max_power)) {
          data.power = power * config.daumRanges.power_factor // multiply with factor 5, see Daum spec
        }
      }
      // calculating the speed based on the RPM to gain some accuracy; speed signal is only integer
      // as long os the gearRatio is the same as in the spec of DAUM, the actual speed on the display and the calculated one will be the same
      // var gearRatio = config.gears.ratioLow + (data.gear - 1) * config.gears.ratioHigh // MICHAEL's: 34:25 & 50:11 20 speed; DAUM: the ratio starts from 42:24 and ends at 53:12; see TRS_8008 Manual page 57
      var gearRatio = config.gearbox['g' + data.gear] // MICHAEL's: 34:25 & 50:11 20 speed; DAUM: the ratio starts from 42:24 and ends at 53:12; see TRS_8008 Manual page 57
      var circumference = config.gears.circumference // cirvumference in cm
      var distance = gearRatio * circumference // distance in cm per rotation
      var speed = data.rpm * distance * config.gears.speedConversion // speed in km/h
      // var speed = (states[7 + index])
      if (!isNaN(speed) && (speed >= config.daumRanges.min_speed && speed <= config.daumRanges.max_speed)) {
        data.speed = Number(speed).toFixed(1) // reduce number of decimals after calculation to 1
        global.globalspeed_daum = data.speed // global variables used, because I cannot code ;)
        if (global.globalmode === 'SIM') { // run power simulation here in parallel to server.js to enhance resolution of resistance, e.g.: ble only triggers sim once per second, but if you pedal faster, this needs to be here.
          daumSIM.physics(global.globalwindspeed_ble, global.globalgrade_ble, global.globalcrr_ble, global.globalcw_ble, global.globalrpm_daum, global.globalspeed_daum, global.globalgear_daum)
          self.setPower(Number(global.globalsimpower_daum).toFixed(0))
        }
      }
      if (Object.keys(data).length > 0) self.emitter.emit('data', data) // emit data for further use
    } else {
      self.unknownHandler(numbers) // is obsolete, becasuse of custom parser that parses 40 bytes - but just in case to have some error handling
    }
  }
  // //////////////////////////////////////////////////////////////////////////
  // unknown handlers start
  // //////////////////////////////////////////////////////////////////////////
  this.unknownHandler = function (numbers) {
    if (DEBUG) console.log('[daumUSB.js] - unknownHandler - Unrecognized packet: ', numbers)
    self.emitter.emit('error', '[daumUSB.js] - unknownHandler: ' + numbers)
  }
  // //////////////////////////////////////////////////////////////////////////
  // open port as specified by daum
  // /////////////////////////////////////////////////////////////////////////
  this.open = function () {
//    com.list(function (err, ports) {
    com.list().then(ports => {
      //if (err) {
      //  self.emitter.emit('error', '[daumUSB.js] - open: ' + err)
      //  throw err
      //}
      ports.forEach(function (p) {
        if (p.vendorId && p.productId) { // ??? don't know if this is the ID of ergobike, or the serial adapter, this has to be configured for every bike, so I might skip it
          if (DEBUG) console.log('[daumUSB.js] - open:' + p.vendorId + '  ' + p.productId) // RS232 converter Ids
          if (DEBUG) console.log('[daumUSB.js] - open - Ergobike found on port ' + p.path)
          self.emitter.emit('key', '[daumUSB.js] - Ergobike found on port ' + p.path)
          //var port = new com.SerialPort(p.comName, {
           var port = new com (p.path, {
            baudrate: config.port.baudRate,
            dataBits: config.port.dataBits,
            parity: config.port.parity,
            stopBits: config.port.stopBits,
            flowControl: config.port.flowControl,
            //parser: 40 
            //parser: com.pipe(new ByteLength({length: config.port.parserLength}) ) 
            //parser: com.parsers.byteLength(config.port.parserLength) // custom parser set to byte length that is more than the actual response message of ergobike, but no other way possible right know
          }, false) // thats why the index loops in 'readAndDispatch' are used to get the prefix of each command
          //var parser = port.pipe(new ByteLength({length: config.port.parserLength}))
          var parser = port.pipe(new ByteLength({length: config.port.parserLength}))
          //var parser = port.pipe(new ByteLength({length: 19}))
          //parser.on('data', console.log)  
          port.open(function () {
            self.port = port
            port.on('data', self.readAndDispatch)
            parser.on('data',self.readAndDispatch)
            self.writer = setInterval(self.flushNext, config.intervals.flushNext) // this is writing the data to the port; i've put here the timeout of DAUM interface spec; 50ms
            if (gotAdressSuccess === false) { // check, otherwise after a restart via webserver, this will run again
              if (DEBUG) console.log('[daumUSB.js] - looking for cockpit adress')
              self.emitter.emit('key', '[daumUSB.js] - looking for cockpit adress')
              self.readeradress = setInterval(self.getAdress, config.intervals.getAdress) // continiously get adress from ergobike, the interval is canceled if gotAdressSuccess is true
            }
            if (DEBUG) console.log('[daumUSB.js] - runData')
            self.emitter.emit('key', '[daumUSB.js] - runData')
            self.reader = setInterval(self.runData, config.intervals.runData) // continiously get 'run_Data' from ergobike; 500ms means, every 1000ms a buffer
          })
        }
      })
    })
    return self.emitter
  }
  // //////////////////////////////////////////////////////////////////////////
  // restart port
  // //////////////////////////////////////////////////////////////////////////
  this.restart = function () {
    if (DEBUG) console.log('[daumUSB.js] - Daum restart')
    if (self.port.isOpen) {
      self.stop()
      self.port.close()
    }
    setTimeout(self.open, config.timeouts.open)
    setTimeout(self.start, config.timeouts.start)
  }
  // //////////////////////////////////////////////////////////////////////////
  // start sequence - this is just a dummy, because getAdress is used during port initialization
  // //////////////////////////////////////////////////////////////////////////
  this.start = function () { // set gear as second, to enable switching gears with jog wheel or buttons in cockpit by default
    self.setProgram(0) // reset to program 0
    self.emitter.emit('key', '[daumUSB.js] - setProgram to 0')
    self.setGear(config.daumRanges.min_gear) // reset the gearsto 0; this forces daum cockpit to change gears instead of power when using the buttons or the jog wheel
    self.emitter.emit('key', '[daumUSB.js] - setGear to 0')
  }
  // //////////////////////////////////////////////////////////////////////////
  // stop port - no start function, use restart after stop
  // //////////////////////////////////////////////////////////////////////////
  this.stop = function () {
    self.pending = [] // overwrite pending array - like flush
    if (self.writer) {
      clearInterval(self.writer) // stop writing to port
    }
    if (self.reader) {
      clearInterval(self.reader) // stop reading 'run_data' from port
    }
    if (self.readeradress) {
      clearInterval(self.readeradress) // stop reading adress from port - this is canceled as soon as gotAdressSuccess is true, but in case stop happens before this event.
    }
  }
  // //////////////////////////////////////////////////////////////////////////
  // set daum command function - general function for sending data - still testing
  // //////////////////////////////////////////////////////////////////////////
  this.setDaumCommand = function (command, adress, sendData) {
    if (command !== config.daumCommands.get_Adress) {
      if (gotAdressSuccess === true) {
        if (DEBUG) console.log('[daumUSB.js] - set command [0x' + command + ']: ' + sendData)
        if (sendData === 'none') { // this is for commands that just have command and adress - no data
          var datas = Buffer.from(command + ('00' + (adress).toString()).slice(-2), 'hex')
        } else { // this is for commands that have command, adress and data
          datas = Buffer.from(command + ('00' + (adress).toString()).slice(-2) + ('00' + (sendData).toString(16)).slice(-2), 'hex')
        }
        self.write(datas)
      } else { // if no cockpit adress found, just post the message and not execute the command
        if (DEBUG) console.log('[daumUSB.js] - cannot set command [0x' + command + '] - no cockpit adress')
        self.emitter.emit('error', '[daumUSB.js] - cannot set command [0x' + command + '] - no cockpit adress')
      }
    } else { // this is just for get adress
      datas = Buffer.from(command, 'hex')
      self.write(datas)
    }
  }
  // //////////////////////////////////////////////////////////////////////////
  // get cockpit adress - simplified by using setDaumCommand function
  // //////////////////////////////////////////////////////////////////////////
  this.getAdress = function () {
    self.setDaumCommand(config.daumCommands.get_Adress, 'none', 'none')
  }
  // //////////////////////////////////////////////////////////////////////////
  // get person data 1
  // //////////////////////////////////////////////////////////////////////////
  this.getPersonData = function () {
    self.setDaumCommand(config.daumCommands.get_PersonData, daumCockpitAdress, 'none')
  }
  // //////////////////////////////////////////////////////////////////////////
  // get 'run_Data' from ergobike
  // //////////////////////////////////////////////////////////////////////////
  this.runData = function () {
    self.setDaumCommand(config.daumCommands.run_Data, daumCockpitAdress, 'none')
  }
  // //////////////////////////////////////////////////////////////////////////
  // set the power resistance
  // //////////////////////////////////////////////////////////////////////////
  this.setPower = function (power) { // power validation is done here to dont loose quality in other functions
    if (power < config.daumRanges.min_power * config.daumRanges.power_factor) power = config.daumRanges.min_power * config.daumRanges.power_factor // cut negative or too low power values from simulation
    if (power > config.daumRanges.max_power * config.daumRanges.power_factor) power = config.daumRanges.max_power * config.daumRanges.power_factor // cut too high power calculations
    var ergopower = Math.round(power / config.daumRanges.power_factor) // round up and to step of 5 to match daum spec and devide by 5
    self.setDaumCommand(config.daumCommands.set_Watt, daumCockpitAdress, ergopower)
  }
  // //////////////////////////////////////////////////////////////////////////
  // set a program
  // //////////////////////////////////////////////////////////////////////////
  this.setProgram = function (programID) {
    self.setDaumCommand(config.daumCommands.set_Prog, daumCockpitAdress, programID)
  }
  // //////////////////////////////////////////////////////////////////////////
  // set watt profile / increment or decrement 5 watt
  // //////////////////////////////////////////////////////////////////////////
  this.setWattProfile = function (profile) {
    self.setDaumCommand(config.daumCommands.set_WattProfile, daumCockpitAdress, profile)
  }
  // //////////////////////////////////////////////////////////////////////////
  // set a gear
  // //////////////////////////////////////////////////////////////////////////
  this.setGear = function (gear) {
    self.setDaumCommand(config.daumCommands.set_Gear, daumCockpitAdress, gear)
  }
  // //////////////////////////////////////////////////////////////////////////
  // to string ????????? - self.toString is not used here
  // //////////////////////////////////////////////////////////////////////////
  this.toString = function () {
    return 'Daum on ' + self.port.comName
  }
}
module.exports = daumUSB // export for use in other scripts, e.g.: server.js
