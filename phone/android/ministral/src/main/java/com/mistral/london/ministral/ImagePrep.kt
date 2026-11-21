// ImagePrep.kt -- image file or Bitmap -> packed RGB bytes for mtmd_bitmap_init. UNCOMPILED.
package com.mistral.london.ministral

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

/** Packed RGB, 3 bytes per pixel, row-major, no padding (what mtmd_bitmap_init expects). */
class RGBImage(val width: Int, val height: Int, val data: ByteArray)

object ImagePrep {
    /** Target size: longest side <= maxSide, aspect preserved, never upscaled. */
    internal fun fitted(w: Int, h: Int, maxSide: Int): Pair<Int, Int> {
        val longest = max(w, h)
        if (maxSide <= 0 || longest <= maxSide) return w to h
        val s = maxSide.toDouble() / longest
        return max(1, (w * s).roundToInt()) to max(1, (h * s).roundToInt())
    }

    /** File path (camera/gallery JPEG, PNG, HEIF): applies EXIF orientation, then scales. */
    fun rgb(file: File, maxSide: Int = 640): RGBImage? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        // Power-of-two subsample while the result stays >= maxSide (keeps decode memory small).
        var sample = 1
        while (maxSide > 0 && max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val bmp = BitmapFactory.decodeFile(file.path, opts) ?: return null
        val orientation = try {
            ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (_: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
        return rgb(bmp, maxSide, orientation)
    }

    /**
     * Bitmap path. [exifOrientation] is an ExifInterface.ORIENTATION_* value (default: already upright).
     * Orientation is baked in by the Matrix, then the image is scaled to the tier's size in the same pass.
     */
    fun rgb(src: Bitmap, maxSide: Int = 640, exifOrientation: Int = ExifInterface.ORIENTATION_NORMAL): RGBImage? {
        val m = Matrix()
        when (exifOrientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.postScale(-1f, 1f) }
        }
        val swap = exifOrientation in setOf(
            ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_ROTATE_270,
            ExifInterface.ORIENTATION_TRANSPOSE, ExifInterface.ORIENTATION_TRANSVERSE)
        val uprightW = if (swap) src.height else src.width
        val uprightH = if (swap) src.width else src.height
        val (w, h) = fitted(uprightW, uprightH, maxSide)
        if (w <= 0 || h <= 0) return null
        m.postScale(w.toFloat() / uprightW, h.toFloat() / uprightH)
        val upright = try {
            Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
        } catch (_: Throwable) {
            return null
        }
        // Hardware or non-ARGB_8888 bitmaps cannot be read with getPixels: copy first.
        val argb = if (upright.config == Bitmap.Config.ARGB_8888) upright
                   else (upright.copy(Bitmap.Config.ARGB_8888, false) ?: return null)
        val pw = argb.width
        val ph = argb.height
        val px = IntArray(pw * ph)
        argb.getPixels(px, 0, pw, 0, 0, pw, ph)
        // ARGB_8888 -> RGB, compositing on white so transparent PNGs do not turn black.
        val out = ByteArray(pw * ph * 3)
        var d = 0
        for (p in px) {
            val a = p ushr 24
            val r = (p shr 16) and 0xFF
            val g = (p shr 8) and 0xFF
            val b = p and 0xFF
            if (a == 255) {
                out[d] = r.toByte(); out[d + 1] = g.toByte(); out[d + 2] = b.toByte()
            } else {
                val ia = 255 - a
                out[d] = ((r * a + 255 * ia) / 255).toByte()
                out[d + 1] = ((g * a + 255 * ia) / 255).toByte()
                out[d + 2] = ((b * a + 255 * ia) / 255).toByte()
            }
            d += 3
        }
        return RGBImage(pw, ph, out)
    }
}
