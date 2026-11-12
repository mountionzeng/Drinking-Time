import Foundation
import Vision
import ImageIO
let paths=Array(CommandLine.arguments.dropFirst())
var output:[[String:Any]]=[]
for path in paths {
 let request=VNRecognizeTextRequest()
 request.recognitionLevel = .accurate
 request.recognitionLanguages=["zh-Hans","zh-Hant","en-US"]
 request.usesLanguageCorrection=true
 do {
  try VNImageRequestHandler(url:URL(fileURLWithPath:path),options:[:]).perform([request])
  let lines=(request.results ?? []).compactMap { o -> [String:Any]? in
   guard let text=o.topCandidates(1).first else{return nil}
   return ["text":text.string,"confidence":text.confidence,"y":o.boundingBox.origin.y,"x":o.boundingBox.origin.x]
  }
  output.append(["path":path,"lines":lines])
 } catch {output.append(["path":path,"error":"OCR failed"])}
}
let data=try JSONSerialization.data(withJSONObject:output,options:[.sortedKeys])
FileHandle.standardOutput.write(data)
