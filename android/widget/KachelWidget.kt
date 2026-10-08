package ch.kachelkalender.app

// Startbildschirm-Widget: zeigt die nächsten Termine.
// Die App legt sie als kk-widget.json in ihren eigenen Ordner; nichts verlässt das Gerät.
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.text.style.StyleSpan
import android.widget.RemoteViews
import org.json.JSONArray
import java.io.File

class KachelWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) draw(ctx, mgr, id)
    }

    companion object {
        @JvmStatic
        fun refresh(ctx: Context) {
            try {
                val mgr = AppWidgetManager.getInstance(ctx)
                val ids = mgr.getAppWidgetIds(ComponentName(ctx, KachelWidget::class.java))
                for (id in ids) draw(ctx, mgr, id)
            } catch (e: Exception) { }
        }

        private fun findData(ctx: Context): File? {
            for (root in listOf(ctx.dataDir, ctx.filesDir)) {
                try {
                    val hit = root.walkTopDown().maxDepth(4).firstOrNull { it.name == "kk-widget.json" }
                    if (hit != null) return hit
                } catch (e: Exception) { }
            }
            return null
        }

        private fun draw(ctx: Context, mgr: AppWidgetManager, id: Int) {
            val v = RemoteViews(ctx.packageName, R.layout.kachel_widget)
            val sb = SpannableStringBuilder()
            try {
                val f = findData(ctx)
                if (f != null) {
                    val arr = JSONArray(f.readText())
                    val now = System.currentTimeMillis()
                    var n = 0
                    var lastDay = ""
                    for (i in 0 until arr.length()) {
                        val o = arr.getJSONObject(i)
                        if (o.optLong("end", 0) < now) continue
                        val day = o.optString("day")
                        if (day != lastDay) {
                            if (sb.isNotEmpty()) sb.append("\n")
                            val s = sb.length
                            sb.append(day.uppercase()).append("\n")
                            sb.setSpan(StyleSpan(Typeface.BOLD), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                            sb.setSpan(RelativeSizeSpan(0.8f), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                            sb.setSpan(ForegroundColorSpan(Color.parseColor("#97A3B3")), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                            lastDay = day
                        }
                        val d = sb.length
                        sb.append("● ")
                        try { sb.setSpan(ForegroundColorSpan(Color.parseColor(o.optString("color", "#6C9CFF"))), d, d + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) } catch (e: Exception) { }
                        val t = sb.length
                        sb.append(o.optString("time")).append("  ")
                        sb.setSpan(ForegroundColorSpan(Color.parseColor("#B5BFCC")), t, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        sb.append(o.optString("title")).append("\n")
                        n++
                        if (n >= 10) break
                    }
                }
            } catch (e: Exception) { }
            if (sb.isEmpty()) sb.append("Keine Termine in den nächsten Tagen")
            v.setTextViewText(R.id.kw_list, sb.trimEnd())
            val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            if (launch != null) {
                v.setOnClickPendingIntent(R.id.kw_root, PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            }
            mgr.updateAppWidget(id, v)
        }
    }
}
