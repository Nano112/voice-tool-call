#!/usr/bin/env swift
// Minimal mic recorder using AVFoundation — works reliably on macOS.
// Usage: swift record.swift output.wav
// Stops when stdin closes (parent sends newline or closes pipe).

import AVFoundation
import Foundation

guard CommandLine.arguments.count > 1 else {
    fputs("Usage: swift record.swift <output.wav>\n", stderr)
    exit(1)
}

let outputPath = CommandLine.arguments[1]
let url = URL(fileURLWithPath: outputPath)

// Request mic permission
let semaphore = DispatchSemaphore(value: 0)
var permissionGranted = false

AVCaptureDevice.requestAccess(for: .audio) { granted in
    permissionGranted = granted
    semaphore.signal()
}
semaphore.wait()

guard permissionGranted else {
    fputs("Microphone permission denied.\n", stderr)
    exit(1)
}

// Set up audio engine
let engine = AVAudioEngine()
let inputNode = engine.inputNode
let inputFormat = inputNode.outputFormat(forBus: 0)

// Target format: 16kHz mono
guard let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false) else {
    fputs("Failed to create target format.\n", stderr)
    exit(1)
}

guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
    fputs("Failed to create audio converter.\n", stderr)
    exit(1)
}

var audioBuffers: [AVAudioPCMBuffer] = []
let bufferLock = NSLock()

inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { buffer, _ in
    let ratio = 16000.0 / inputFormat.sampleRate
    let frameCapacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio)
    guard frameCapacity > 0, let convertedBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: frameCapacity) else { return }

    var error: NSError?
    converter.convert(to: convertedBuffer, error: &error) { _, outStatus in
        outStatus.pointee = .haveData
        return buffer
    }

    if error == nil && convertedBuffer.frameLength > 0 {
        bufferLock.lock()
        audioBuffers.append(convertedBuffer)
        bufferLock.unlock()
    }
}

func saveAndExit() {
    engine.stop()
    inputNode.removeTap(onBus: 0)

    bufferLock.lock()
    let buffers = audioBuffers
    bufferLock.unlock()

    let totalFrames = buffers.reduce(0) { $0 + Int($1.frameLength) }
    guard totalFrames > 0, let outputFile = try? AVAudioFile(forWriting: url, settings: targetFormat.settings) else {
        fputs("No audio captured.\n", stderr)
        exit(1)
    }

    for buffer in buffers {
        try? outputFile.write(from: buffer)
    }

    fputs("OK \(totalFrames)\n", stdout)
    exit(0)
}

do {
    try engine.start()
    fputs("RECORDING\n", stdout)
} catch {
    fputs("Failed to start: \(error)\n", stderr)
    exit(1)
}

// Wait for any stdin input to stop recording
DispatchQueue.global().async {
    _ = readLine()
    saveAndExit()
}

// Keep alive
RunLoop.main.run()
