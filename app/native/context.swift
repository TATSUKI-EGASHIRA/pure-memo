// Capture context for pure.: what is selected in the frontmost app, where it came from,
// and when the pasteboard last changed. Runs as a child of pure., so macOS asks for
// Accessibility / Automation on pure.'s behalf.
//
//   context-helper capture [--exclude id1,id2] [--no-copy]   one JSON object
//   context-helper status                                     {"trusted":bool}
//   context-helper prompt                                     asks for Accessibility, then status
//   context-helper watch-pasteboard                           JSON line per pasteboard change
import AppKit
import ApplicationServices
import Carbon

struct App: Encodable { let name: String; let bundleId: String }
struct Capture: Encodable {
    let trusted: Bool
    let secureInput: Bool
    let excluded: Bool
    let app: App?
    let windowTitle: String?
    let selection: String?
    let selectionVia: String?
    let url: String?
    let pageTitle: String?
}

func emit<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    if let data = try? encoder.encode(value) { FileHandle.standardOutput.write(data); FileHandle.standardOutput.write("\n".data(using: .utf8)!) }
}

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

// Selected text through Accessibility; nil when the app does not expose it (often web views).
func selectedText(pid: pid_t) -> String? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.25)
    guard let focused = attribute(app, kAXFocusedUIElementAttribute) else { return nil }
    let element = focused as! AXUIElement
    if let role = attribute(element, kAXRoleAttribute) as? String, role == "AXSecureTextField" { return nil }
    guard let text = attribute(element, kAXSelectedTextAttribute) as? String else { return nil }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : text
}

func windowTitle(pid: pid_t) -> String? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.25)
    guard let window = attribute(app, kAXFocusedWindowAttribute) else { return nil }
    return attribute(window as! AXUIElement, kAXTitleAttribute) as? String
}

// Fallback for apps without AX text: ⌘C, read, then put the previous pasteboard back.
func copySelection() -> String? {
    let board = NSPasteboard.general
    let saved = (board.pasteboardItems ?? []).map { item -> NSPasteboardItem in
        let copy = NSPasteboardItem()
        for type in item.types { if let data = item.data(forType: type) { copy.setData(data, forType: type) } }
        return copy
    }
    let before = board.changeCount
    let source = CGEventSource(stateID: .combinedSessionState)
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: down)
        event?.flags = .maskCommand
        event?.post(tap: .cghidEventTap)
    }
    var text: String?
    for _ in 0..<20 {
        usleep(10_000)
        if board.changeCount != before { text = board.string(forType: .string); break }
    }
    if board.changeCount != before {
        board.clearContents()
        if !saved.isEmpty { board.writeObjects(saved) }
    }
    guard let value = text, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    return value
}

// Active tab of the known browsers through Apple Events (asks for Automation once per browser).
let chromium = ["com.google.Chrome", "company.thebrowser.Browser", "com.brave.Browser", "com.microsoft.edgemac", "com.vivaldi.Vivaldi", "com.google.Chrome.canary"]
func browserTab(bundleId: String) -> (String, String)? {
    let script: String
    if bundleId == "com.apple.Safari" || bundleId == "com.apple.SafariTechnologyPreview" {
        script = "tell application id \"\(bundleId)\" to return {URL, name} of front document"
    } else if chromium.contains(bundleId) {
        script = "tell application id \"\(bundleId)\" to return {URL, title} of active tab of front window"
    } else { return nil }
    var error: NSDictionary?
    guard let result = NSAppleScript(source: script)?.executeAndReturnError(&error), result.numberOfItems == 2,
          let url = result.atIndex(1)?.stringValue, url.hasPrefix("http") else { return nil }
    return (url, result.atIndex(2)?.stringValue ?? "")
}

let arguments = Array(CommandLine.arguments.dropFirst())
let command = arguments.first ?? "capture"
struct Status: Encodable { let trusted: Bool }

switch command {
case "status":
    emit(Status(trusted: AXIsProcessTrusted()))
case "prompt":
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    emit(Status(trusted: AXIsProcessTrustedWithOptions(options)))
case "read-pasteboard":
    // Text and image of the current pasteboard; concealed items (password managers) are never read.
    struct Contents: Encodable { let text: String?; let pngBase64: String? }
    let board = NSPasteboard.general
    let types = board.types ?? []
    let concealed = ["org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType"].map { NSPasteboard.PasteboardType($0) }
    if types.contains(where: concealed.contains) { emit(Contents(text: nil, pngBase64: nil)); exit(0) }
    let text = board.string(forType: .string).map { String($0.prefix(20_000)) }
    var png: Data? = board.data(forType: .png)
    if png == nil, let tiff = board.data(forType: .tiff), let rep = NSBitmapImageRep(data: tiff) { png = rep.representation(using: .png, properties: [:]) }
    emit(Contents(text: text, pngBase64: png.flatMap { $0.count <= 8 * 1024 * 1024 ? $0.base64EncodedString() : nil }))
case "watch-pasteboard":
    // One line per change; concealed / transient items (password managers) are flagged, never read.
    struct Change: Encodable { let changeCount: Int; let concealed: Bool; let hasImage: Bool; let hasText: Bool }
    let board = NSPasteboard.general
    var last = board.changeCount
    let concealedTypes = ["org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType", "org.nspasteboard.AutoGeneratedType"].map { NSPasteboard.PasteboardType($0) }
    setvbuf(stdout, nil, _IOLBF, 0)
    while true {
        usleep(400_000)
        if getppid() == 1 { exit(0) }
        let count = board.changeCount
        guard count != last else { continue }
        last = count
        let types = board.types ?? []
        emit(Change(changeCount: count, concealed: types.contains(where: concealedTypes.contains),
                    hasImage: types.contains(.png) || types.contains(.tiff), hasText: types.contains(.string)))
    }
default:
    var excluded: Set<String> = []
    if let index = arguments.firstIndex(of: "--exclude"), index + 1 < arguments.count {
        excluded = Set(arguments[index + 1].split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() })
    }
    let allowCopy = !arguments.contains("--no-copy")
    let trusted = AXIsProcessTrusted()
    let secure = IsSecureEventInputEnabled()
    guard let front = NSWorkspace.shared.frontmostApplication else {
        emit(Capture(trusted: trusted, secureInput: secure, excluded: false, app: nil, windowTitle: nil, selection: nil, selectionVia: nil, url: nil, pageTitle: nil))
        exit(0)
    }
    let bundleId = front.bundleIdentifier ?? ""
    let name = front.localizedName ?? bundleId
    let app = App(name: name, bundleId: bundleId)
    // Excluded apps and secure input (password fields) give nothing but the app name.
    let isExcluded = excluded.contains(bundleId.lowercased()) || excluded.contains(name.lowercased())
    if isExcluded || secure {
        emit(Capture(trusted: trusted, secureInput: secure, excluded: isExcluded, app: app, windowTitle: nil, selection: nil, selectionVia: nil, url: nil, pageTitle: nil))
        exit(0)
    }
    var selection: String?
    var via: String?
    if trusted {
        if let text = selectedText(pid: front.processIdentifier) { selection = text; via = "ax" }
        else if allowCopy, let text = copySelection() { selection = text; via = "copy" }
    }
    let tab = browserTab(bundleId: bundleId)
    emit(Capture(trusted: trusted, secureInput: false, excluded: false, app: app,
                 windowTitle: trusted ? windowTitle(pid: front.processIdentifier) : nil,
                 selection: selection.map { String($0.prefix(20_000)) }, selectionVia: via, url: tab?.0, pageTitle: tab?.1))
}
