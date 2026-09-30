import Foundation
import NaturalLanguage

struct Input: Decodable { let texts: [String] }
struct Output: Encodable { let model: String; let vectors: [[Double]?] }

func pooledVector(_ text: String, using embedding: NLContextualEmbedding) -> [Double]? {
    guard !text.isEmpty, let result = try? embedding.embeddingResult(for: String(text.prefix(2000)), language: .japanese) else { return nil }
    var sum = Array(repeating: 0.0, count: embedding.dimension)
    var count = 0
    result.enumerateTokenVectors(in: result.string.startIndex..<result.string.endIndex) { vector, _ in
        if vector.count == sum.count {
            for index in sum.indices { sum[index] += vector[index] }
            count += 1
        }
        return true
    }
    guard count > 0 else { return nil }
    let length = sqrt(sum.reduce(0.0) { $0 + $1 * $1 })
    guard length > 0 else { return nil }
    return sum.map { $0 / length }
}

do {
    guard let embedding = NLContextualEmbedding(language: .japanese), embedding.hasAvailableAssets else {
        throw NSError(domain: "pure.embedding", code: 1, userInfo: [NSLocalizedDescriptionKey: "Japanese embedding assets are unavailable"])
    }
    let input = try JSONDecoder().decode(Input.self, from: FileHandle.standardInput.readDataToEndOfFile())
    guard input.texts.count <= 256 else { throw NSError(domain: "pure.embedding", code: 2, userInfo: [NSLocalizedDescriptionKey: "Too many texts"] ) }
    try embedding.load()
    let vectors = input.texts.map { pooledVector($0, using: embedding) }
    embedding.unload()
    let output = Output(model: "\(embedding.modelIdentifier):\(embedding.revision):mean-v1", vectors: vectors)
    FileHandle.standardOutput.write(try JSONEncoder().encode(output))
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
