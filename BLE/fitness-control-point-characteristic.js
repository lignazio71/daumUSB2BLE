var Bleno = require('bleno')
const config = require('config-yml') // Use config for yaml config files in Node.js projects
var DEBUG = config.DEBUG.BLE

// Spec
// Control point op code
var ControlPointOpCode = {
  requestControl: 0x00,
  resetControl: 0x01,
  setTargetSpeed: 0x02,
  setTargetInclincation: 0x03,
  setTargetResistanceLevel: 0x04,
  setTargetPower: 0x05,
  setTargetHeartRate: 0x06,
  startOrResume: 0x07,
  stopOrPause: 0x08,
  setTargetedExpendedEnergy: 0x09,
  setTargetedNumberOfSteps: 0x0A,
  setTargetedNumberOfStrides: 0x0B,
  setTargetedDistance: 0x0C,
  setTargetedTrainingTime: 0x0D,
  setTargetedTimeInTwoHeartRateZones: 0x0E,
  setTargetedTimeInThreeHeartRateZones: 0x0F,
  setTargetedTimeInFiveHeartRateZones: 0x10,
  setIndoorBikeSimulationParameters: 0x11,
  setWheelCircumference: 0x12,
  spinDownControl: 0x13,
  setTargetedCadence: 0x14,
  responseCode: 0x80
}

var ResultCode = {
  reserved: 0x00,
  success: 0x01,
  opCodeNotSupported: 0x02,
  invalidParameter: 0x03,
  operationFailed: 0x04,
  controlNotPermitted: 0x05
}

class FitnessControlPoint extends Bleno.Characteristic {
  constructor (callback) {
    super({
      uuid: '2AD9',
      value: null,
      properties: ['write'],
      descriptors: [
        new Bleno.Descriptor({
          // Client Characteristic Configuration
          uuid: '2902',
          value: Buffer.alloc(2)
        })
      ]
    })

    this.underControl = false
    if (!callback) {
      throw 'callback cant be null'
    }
    this.serverCallback = callback
  }

  // Follow Control Point instruction from the client
  onWriteRequest (data, offset, withoutResponse, callback) {
    var state = data.readUInt8(0)
    callback(this.RESULT_SUCCESS);  // added as in orignal kattlerUSB2BLE

    switch (state) {
      case ControlPointOpCode.requestControl:
        if (DEBUG) console.log('[fitness-control-point-characteristic.js] - ControlPointOpCode.requestControl.')
        if (!this.underControl) {
          if (this.serverCallback('control')) {
            if (DEBUG) console.log('[fitness-control-point-characteristic.js] - control succeed.')
            this.underControl = true
            callback(this.buildResponse(state, ResultCode.success)) // ok
          } else {
            if (DEBUG) console.log('[fitness-control-point-characteristic.js] - control aborted.')
            callback(this.buildResponse(state, ResultCode.operationFailed))
          }
        } else {
          if (DEBUG) console.log('[fitness-control-point-characteristic.js] - allready controled.')
          callback(this.buildResponse(state, ResultCode.controlNotPermitted))
        }
        break

      case ControlPointOpCode.resetControl:
        if (DEBUG) console.log('[fitness-control-point-characteristic.js] - ControlPointOpCode.resetControl.')
        if (this.underControl) {
          // reset the bike
          if (this.serverCallback('[fitness-control-point-characteristic.js] - reset')) {
            this.underControl = false
            callback(this.buildResponse(state, ResultCode.success)) // ok
          } else {
            if (DEBUG) console.log('[fitness-control-point-characteristic.js] - control reset controled.')
            callback(this.buildResponse(state, ResultCode.operationFailed))
          }
        } else {
          if (DEBUG) console.log('[fitness-control-point-characteristic.js] - reset without control.')
          callback(this.buildResponse(state, ResultCode.controlNotPermitted))
        }
        break

      case ControlPointOpCode.setTargetPower: // this is ERG MODE
        global.globalmode = 'ERG' // this is overriding the toggles from webserver
        global.globalswitch = 'Power' // this is overriding the toggles from webserver
        if (DEBUG) console.log('[fitness-control-point-characteristic.js] - ControlPointOpCode.setTargetPower.')
        if (this.underControl) {
          var watt = data.readUInt16LE(1)
          if (DEBUG) console.log('[fitness-control-point-characteristic.js] - Target Power set to: ' + watt)
          if (this.serverCallback('power', watt)) {
            callback(this.buildResponse(state, ResultCode.success)) // ok
            // } else {
            // if (DEBUG) console.log('[fitness-control-point-characteristic.js] - setTarget failed');
            // callback(this.buildResponse(state, ResultCode.operationFailed));
          }
        } else {
          if (DEBUG) console.log('[fitness-control-point-characteristic.js] - setTargetPower without control.')
          callback(this.buildResponse(state, ResultCode.controlNotPermitted))
        }
        break

      case ControlPointOpCode.startOrResume:
        if (DEBUG) console.log('[fitness-control-point-characteristic.js] - ControlPointOpCode.startOrResume')
        callback(this.buildResponse(state, ResultCode.success))
        break
      case ControlPointOpCode.stopOrPause:
        if (DEBUG) console.log('[fitness-control-point-characteristic.js] - ControlPointOpCode.stopOrPause')
        callback(this.buildResponse(state, ResultCode.success))
        break
      case ControlPointOpCode.setIndoorBikeSimulationParameters: // this is SIM MODE
        global.globalmode = 'SIM' // this is overriding the toggles from webserver
        global.globalswitch = 'Gear' // this is overriding the toggles from webserver
        if (DEBUG) console.log('[fitness-control-point-characteristic.js] - ControlPointOpCode.setIndoorBikeSimulationParameters')
        var windspeed = data.readInt16LE(1) * 0.001
        var grade = data.readInt16LE(3) * 0.01
        var crr = data.readUInt8(5) * 0.0001
        var cw = data.readUInt8(6) * 0.01
        if (DEBUG) console.log('[fitness-control-point-characteristic.js] - setIndoorBikeSimulationParameters - windspeed: ', windspeed)
        if (DEBUG) console.log('[fitness-control-point-characteristic.js] - setIndoorBikeSimulationParameters - grade: ', grade)
        if (DEBUG) console.log('[fitness-control-point-characteristic.js] - setIndoorBikeSimulationParameters - crr: ', crr)
        if (DEBUG) console.log('[fitness-control-point-characteristic.js] - setIndoorBikeSimulationParameters - cw: ', cw)
        if (this.serverCallback('simulation', windspeed, grade, crr, cw)) {
          callback(this.buildResponse(state, ResultCode.success))
        } else {
          if (DEBUG) console.log('[fitness-control-point-characteristic.js] - simulation failed')
          callback(this.buildResponse(state, ResultCode.operationFailed))
        }
        break
      default: // anything else : not yet implemented
        if (DEBUG) console.log('[fitness-control-point-characteristic.js] - State is not supported ' + state + '.')
        callback(this.buildResponse(state, ResultCode.opCodeNotSupported))
        break
    }
  };

  // Return the result message
  buildResponse (opCode, resultCode) {
    var buffer = new Buffer.alloc(3)
    buffer.writeUInt8(0x80, 0)
    buffer.writeUInt8(opCode, 1)
    buffer.writeUInt8(resultCode, 2)
    return buffer
  }
}

module.exports = FitnessControlPoint
