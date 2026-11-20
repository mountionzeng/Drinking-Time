import Foundation
import Vision

// Read just the selected crop over stdin. No remote services or temporary image files.
let bytes = FileHandle.standardInput.readDataToEndOfFile()
let handler = VNImageRequestHandler(data: bytes, options: [:])
let ocr = VNRecognizeTextRequest()
ocr.recognitionLevel = .accurate
ocr.recognitionLanguages = ["zh-Hans", "en-US"]
if CommandLine.arguments.contains("--words") {
    try handler.perform([ocr])
    var words: [[String: Any]] = []
    let token = try NSRegularExpression(pattern: "[\\p{L}\\p{N}]+")
    for line in ocr.results ?? [] {
        guard let candidate = line.topCandidates(1).first, candidate.confidence >= 0.25 else { continue }
        let text = candidate.string
        for part in token.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let range = Range(part.range, in: text), let box = try? candidate.boundingBox(for: range)?.boundingBox else { continue }
            words.append(["text": String(text[range]), "confidence": candidate.confidence, "region": ["left": box.minX, "right": box.maxX, "top": 1 - box.maxY, "bottom": 1 - box.minY]])
        }
    }
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: words))
    exit(0)
}
let classify = VNClassifyImageRequest()
try handler.perform([ocr, classify])
let lines = (ocr.results ?? []).compactMap { $0.topCandidates(1).first }
    .filter { $0.confidence >= 0.5 }.map { $0.string }
// Vision's taxonomy may return both a category and its more specific label at the same score.
let candidates = classify.results ?? []
let cutoff = max(0.5, (candidates.first?.confidence ?? 0) - 0.01)
let label = candidates.prefix(while: { $0.confidence >= cutoff }).prefix(2)
    .map { $0.identifier.replacingOccurrences(of: "_", with: " ") }.joined(separator: " / ")
let result = ["text": lines.joined(separator: " "), "object": label]
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
