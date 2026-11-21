// ImagePrep.swift -- UIImage/CGImage -> packed RGB bytes for mtmd_bitmap_init.
// NOT COMPILED. Written on Linux against the llama.cpp b12606 headers only.
import Foundation
import CoreGraphics
#if canImport(UIKit)
import UIKit
#endif

/// Packed RGB, 3 bytes per pixel, row-major, no padding (what `mtmd_bitmap_init` expects).
public struct RGBImage: Sendable {
    public let width: Int
    public let height: Int
    public let data: [UInt8]
}

public enum ImagePrep {
    /// Target size: longest side <= maxSide, aspect preserved, never upscaled.
    static func fitted(_ w: Int, _ h: Int, maxSide: Int) -> (Int, Int) {
        let longest = max(w, h)
        guard longest > maxSide, maxSide > 0 else { return (w, h) }
        let s = Double(maxSide) / Double(longest)
        return (max(1, Int((Double(w) * s).rounded())), max(1, Int((Double(h) * s).rounded())))
    }

    /// CGImage path. CGImage carries no orientation, so callers holding a UIImage
    /// should use the UIImage overload (which bakes orientation in first).
    public static func rgb(from image: CGImage, maxSide: Int = 640) -> RGBImage? {
        let (w, h) = fitted(image.width, image.height, maxSide: maxSide)
        guard w > 0, h > 0 else { return nil }
        var rgba = [UInt8](repeating: 0, count: w * h * 4)
        let drawn: Bool = rgba.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(
                data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            // Composite onto white so transparent PNGs don't turn black.
            ctx.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
            ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
            ctx.interpolationQuality = .high
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return nil }
        // Strip the (skipped) alpha byte: RGBA8 -> RGB8.
        var rgb = [UInt8](repeating: 0, count: w * h * 3)
        var s = 0, d = 0
        while s < rgba.count {
            rgb[d] = rgba[s]; rgb[d + 1] = rgba[s + 1]; rgb[d + 2] = rgba[s + 2]
            s += 4; d += 3
        }
        return RGBImage(width: w, height: h, data: rgb)
    }

    #if canImport(UIKit)
    /// UIImage path: normalises `imageOrientation` by redrawing upright at the target size.
    public static func rgb(from image: UIImage, maxSide: Int = 640) -> RGBImage? {
        let pw = Int((image.size.width * image.scale).rounded())
        let ph = Int((image.size.height * image.scale).rounded())
        let (w, h) = fitted(pw, ph, maxSide: maxSide)
        guard w > 0, h > 0 else { return nil }
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1            // 1 point == 1 pixel
        fmt.opaque = true
        let upright = UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: fmt).image { _ in
            UIColor.white.setFill()
            UIRectFill(CGRect(x: 0, y: 0, width: w, height: h))
            image.draw(in: CGRect(x: 0, y: 0, width: w, height: h))  // applies orientation
        }
        guard let cg = upright.cgImage else { return nil }
        return rgb(from: cg, maxSide: max(w, h))   // already at target size: no further resize
    }
    #endif
}
