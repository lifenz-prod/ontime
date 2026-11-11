// ltc-capture: records one channel of a CoreAudio input device and streams it to stdout.
//
// Chromium hands web pages at most two channels of any input, so a page cannot reach channel 9
// of a 16 channel Dante Virtual Soundcard. This helper opens the device itself and uses the
// HAL unit's channel map to pull out just the channel asked for.
//
//   ltc-capture list
//     prints the input devices as JSON: [{"name": "...", "channels": 16}, ...]
//
//   ltc-capture capture <device name or ""> <channel, 1-based>
//     streams that channel as 32 bit float mono samples (native endian) on stdout, and reports
//     on stderr, one JSON object per line:
//       {"event":"started","device":"...","channels":16,"channel":3,"sampleRate":48000}
//       {"event":"error","message":"..."}
//     It exits when stdin closes, so it never outlives the app that started it.

import AudioToolbox
import CoreAudio
import Foundation

// MARK: - reporting

func report(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
  FileHandle.standardError.write(data)
  FileHandle.standardError.write("\n".data(using: .utf8)!)
}

func fail(_ message: String, code: Int32 = 1) -> Never {
  report(["event": "error", "message": message])
  exit(code)
}

func check(_ status: OSStatus, _ what: String) {
  if status != noErr { fail("\(what) failed (\(status))") }
}

// MARK: - devices

struct InputDevice {
  let id: AudioDeviceID
  let name: String
  let channels: Int
}

func propertyAddress(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func deviceName(_ id: AudioDeviceID) -> String {
  var address = propertyAddress(kAudioObjectPropertyName)
  var name: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &name) == noErr, let value = name else { return "" }
  return value.takeRetainedValue() as String
}

func inputChannelCount(_ id: AudioDeviceID) -> Int {
  var address = propertyAddress(kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeInput)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr, size > 0 else { return 0 }
  let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
  defer { raw.deallocate() }
  guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, raw) == noErr else { return 0 }
  let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
  return list.reduce(0) { $0 + Int($1.mNumberChannels) }
}

func inputDevices() -> [InputDevice] {
  var address = propertyAddress(kAudioHardwarePropertyDevices)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return [] }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr else { return [] }
  return ids.compactMap { id in
    let channels = inputChannelCount(id)
    return channels > 0 ? InputDevice(id: id, name: deviceName(id), channels: channels) : nil
  }
}

func defaultInputDevice() -> AudioDeviceID? {
  var address = propertyAddress(kAudioHardwarePropertyDefaultInputDevice)
  var id = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id) == noErr, id != 0 else { return nil }
  return id
}

func nominalSampleRate(_ id: AudioDeviceID) -> Double {
  var address = propertyAddress(kAudioDevicePropertyNominalSampleRate)
  var rate: Float64 = 0
  var size = UInt32(MemoryLayout<Float64>.size)
  AudioObjectGetPropertyData(id, &address, 0, nil, &size, &rate)
  return rate
}

// MARK: - capture

/// Everything the render callback needs, kept alive for the life of the process
final class Capture {
  let unit: AudioUnit
  let maxFrames: UInt32 = 4096
  let buffer: UnsafeMutablePointer<Float32>
  /// writes leave the audio thread here, so a slow reader never stalls the device
  let writer = DispatchQueue(label: "ltc-capture.writer")

  init(unit: AudioUnit) {
    self.unit = unit
    buffer = UnsafeMutablePointer<Float32>.allocate(capacity: Int(maxFrames))
  }
}

let inputCallback: AURenderCallback = { refCon, flags, timeStamp, busNumber, frameCount, _ in
  let capture = Unmanaged<Capture>.fromOpaque(refCon).takeUnretainedValue()
  let frames = min(frameCount, capture.maxFrames)
  var list = AudioBufferList(
    mNumberBuffers: 1,
    mBuffers: AudioBuffer(mNumberChannels: 1, mDataByteSize: frames * 4, mData: UnsafeMutableRawPointer(capture.buffer))
  )
  let status = AudioUnitRender(capture.unit, flags, timeStamp, busNumber, frames, &list)
  if status != noErr { return status }
  let data = Data(bytes: capture.buffer, count: Int(frames) * 4)
  capture.writer.async {
    FileHandle.standardOutput.write(data)
  }
  return noErr
}

func startCapture(deviceName wanted: String, channel: Int) -> Capture {
  let devices = inputDevices()
  let device: InputDevice
  if wanted.isEmpty {
    guard let id = defaultInputDevice(), let found = devices.first(where: { $0.id == id }) else { fail("There is no default input") }
    device = found
  } else {
    guard let found = devices.first(where: { $0.name == wanted }) else { fail("Input \"\(wanted)\" was not found on this machine", code: 3) }
    device = found
  }
  if channel < 1 || channel > device.channels {
    fail("\(device.name) has \(device.channels) input channel\(device.channels == 1 ? "" : "s"), so there is no channel \(channel)", code: 3)
  }

  var description = AudioComponentDescription(
    componentType: kAudioUnitType_Output,
    componentSubType: kAudioUnitSubType_HALOutput,
    componentManufacturer: kAudioUnitManufacturer_Apple,
    componentFlags: 0,
    componentFlagsMask: 0
  )
  guard let component = AudioComponentFindNext(nil, &description) else { fail("No HAL audio unit") }
  var maybeUnit: AudioUnit?
  check(AudioComponentInstanceNew(component, &maybeUnit), "Creating the audio unit")
  guard let unit = maybeUnit else { fail("Creating the audio unit") }

  let inputBus: AudioUnitElement = 1
  let outputBus: AudioUnitElement = 0
  var on: UInt32 = 1
  var off: UInt32 = 0
  check(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, inputBus, &on, 4), "Enabling input")
  check(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, outputBus, &off, 4), "Disabling output")

  var deviceId = device.id
  check(
    AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &deviceId, UInt32(MemoryLayout<AudioDeviceID>.size)),
    "Choosing \(device.name)"
  )

  let sampleRate = nominalSampleRate(device.id)
  var format = AudioStreamBasicDescription(
    mSampleRate: sampleRate,
    mFormatID: kAudioFormatLinearPCM,
    mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked | kAudioFormatFlagIsNonInterleaved,
    mBytesPerPacket: 4,
    mFramesPerPacket: 1,
    mBytesPerFrame: 4,
    mChannelsPerFrame: 1,
    mBitsPerChannel: 32,
    mReserved: 0
  )
  check(
    AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, inputBus, &format, UInt32(MemoryLayout<AudioStreamBasicDescription>.size)),
    "Setting the sample format"
  )

  // the one channel we hand on is the device's channel N
  var channelMap: [Int32] = [Int32(channel - 1)]
  check(
    AudioUnitSetProperty(unit, kAudioOutputUnitProperty_ChannelMap, kAudioUnitScope_Output, inputBus, &channelMap, UInt32(MemoryLayout<Int32>.size)),
    "Picking channel \(channel)"
  )

  let capture = Capture(unit: unit)
  var callback = AURenderCallbackStruct(inputProc: inputCallback, inputProcRefCon: Unmanaged.passRetained(capture).toOpaque())
  check(
    AudioUnitSetProperty(unit, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 0, &callback, UInt32(MemoryLayout<AURenderCallbackStruct>.size)),
    "Setting the input callback"
  )

  check(AudioUnitInitialize(unit), "Starting the audio unit")
  let started = AudioOutputUnitStart(unit)
  if started != noErr {
    fail("Could not record \(device.name) (\(started)). Check Ontime is allowed the microphone in System Settings → Privacy & Security", code: 4)
  }

  report(["event": "started", "device": device.name, "channels": device.channels, "channel": channel, "sampleRate": sampleRate])

  // the device going away (Dante restarting, a cable pulled) ends us, and the app starts us again
  var alive = propertyAddress(kAudioDevicePropertyDeviceIsAlive)
  AudioObjectAddPropertyListenerBlock(device.id, &alive, DispatchQueue.main) { _, _ in
    fail("\(device.name) went away", code: 5)
  }
  var rate = propertyAddress(kAudioDevicePropertyNominalSampleRate)
  AudioObjectAddPropertyListenerBlock(device.id, &rate, DispatchQueue.main) { _, _ in
    fail("\(device.name) changed sample rate", code: 5)
  }
  return capture
}

// MARK: - main

signal(SIGPIPE, SIG_DFL)
let arguments = CommandLine.arguments

switch arguments.count > 1 ? arguments[1] : "" {
case "list":
  let list = inputDevices().map { ["name": $0.name, "channels": $0.channels] as [String: Any] }
  let data = try! JSONSerialization.data(withJSONObject: list)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
  exit(0)

case "capture":
  let wanted = arguments.count > 2 ? arguments[2] : ""
  let channel = arguments.count > 3 ? Int(arguments[3]) ?? 1 : 1
  let capture = startCapture(deviceName: wanted, channel: channel)
  _ = capture

  // stdin closing means whoever started us has gone
  DispatchQueue.global().async {
    while FileHandle.standardInput.availableData.count > 0 {}
    exit(0)
  }
  dispatchMain()

default:
  FileHandle.standardError.write("usage: ltc-capture list | ltc-capture capture <device> <channel>\n".data(using: .utf8)!)
  exit(64)
}
