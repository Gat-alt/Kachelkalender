package ch.kachelkalender.app

// Startbildschirm-Widget: die ganze Woche als Kacheln (Mo–So) plus eine Kachel «Aufgaben».
// Ein Tipp auf einen Tag öffnet ihn in der App, ein Tipp auf «Aufgaben» die Aufgabenliste.
// Die App legt die Daten als kk-week.json in ihren eigenen Ordner; nichts verlässt das Gerät.
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.text.style.StyleSpan
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.Locale

class KachelWeekWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) draw(ctx, mgr, id)
    }

    override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, opts: Bundle) {
        draw(ctx, mgr, id)
    }

    companion object {
        private val TILES = intArrayOf(R.id.kd0, R.id.kd1, R.id.kd2, R.id.kd3, R.id.kd4, R.id.kd5, R.id.kd6, R.id.kd7)
        private val WD = arrayOf("MO", "DI", "MI", "DO", "FR", "SA", "SO")
        private val MO = arrayOf("Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez.")

        @JvmStatic
        fun refresh(ctx: Context) {
            try {
                val mgr = AppWidgetManager.getInstance(ctx)
                for (id in mgr.getAppWidgetIds(ComponentName(ctx, KachelWeekWidget::class.java))) draw(ctx, mgr, id)
            } catch (e: Exception) { }
        }

        private fun findFile(ctx: Context, name: String): File? {
            for (root in listOf(ctx.dataDir, ctx.filesDir)) {
                try {
                    val hit = root.walkTopDown().maxDepth(4).firstOrNull { it.name == name }
                    if (hit != null) return hit
                } catch (e: Exception) { }
            }
            return null
        }

        // Farbe aufhellen und sättigen, damit sie auf dunklem Grund strahlt
        private fun bright(c: Int): Int {
            val hsv = FloatArray(3)
            Color.colorToHSV(c, hsv)
            hsv[1] = (hsv[1] * 1.1f).coerceIn(0.45f, 0.95f)
            hsv[2] = hsv[2].coerceAtLeast(0.92f)
            return Color.HSVToColor(hsv)
        }

        private fun color(s: String, fb: String) = try { Color.parseColor(s) } catch (e: Exception) { Color.parseColor(fb) }

        private fun open(ctx: Context, what: String, req: Int): PendingIntent? {
            val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
            launch.putExtra("kk_open", what)
            launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            return PendingIntent.getActivity(ctx, req, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        @JvmStatic
        fun draw(ctx: Context, mgr: AppWidgetManager, id: Int) {
            val v = RemoteViews(ctx.packageName, R.layout.kachel_week_widget)
            // Je höher das Widget, desto mehr Termine pro Kachel
            val hDp = try { mgr.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 300) } catch (e: Exception) { 300 }
            val perTile = ((hDp - 44) / 4 - 22).coerceAtLeast(17) / 17

            val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", Locale.ROOT)
            val cal = Calendar.getInstance()
            val today = fmt.format(cal.time)
            cal.add(Calendar.DAY_OF_YEAR, -((cal.get(Calendar.DAY_OF_WEEK) + 5) % 7))
            val mon = cal.clone() as Calendar

            var data: JSONObject? = null
            try { findFile(ctx, "kk-week.json")?.let { data = JSONObject(it.readText()) } } catch (e: Exception) { }
            val byDay = HashMap<String, JSONObject>()
            data?.optJSONArray("days")?.let { arr -> for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { byDay[it.optString("ds")] = it } }

            val c = mon.clone() as Calendar
            val first = c.clone() as Calendar
            for (i in 0 until 7) {
                val ds = fmt.format(c.time)
                val isToday = ds == today
                val sb = SpannableStringBuilder()
                val h = sb.length
                sb.append(WD[i]).append("  ").append(c.get(Calendar.DAY_OF_MONTH).toString())
                sb.setSpan(StyleSpan(Typeface.BOLD), h, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                sb.setSpan(ForegroundColorSpan(if (isToday) Color.parseColor("#FFFFFF") else Color.parseColor("#BDBDBD")), h, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                sb.setSpan(RelativeSizeSpan(1.12f), h, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                if (isToday) { val t = sb.length; sb.append("  heute"); sb.setSpan(RelativeSizeSpan(0.85f), t, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE); sb.setSpan(ForegroundColorSpan(Color.parseColor("#FFFFFF")), t, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
                val day = byDay[ds]
                val items = day?.optJSONArray("items")
                val total = day?.optInt("n", items?.length() ?: 0) ?: 0
                if (items != null && items.length() > 0) {
                    val show = minOf(items.length(), if (total > perTile) maxOf(1, perTile - 1) else perTile)
                    for (k in 0 until show) {
                        val o = items.getJSONObject(k)
                        sb.append("\n")
                        // Schwarz-Weiss: weisser Strich, graue Zeit, weisser Titel (Farbe gibt es erst in der App)
                        val d = sb.length
                        sb.append("▎")
                        sb.setSpan(ForegroundColorSpan(Color.parseColor("#FFFFFF")), d, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        val t = o.optString("t")
                        if (t.isNotEmpty()) {
                            val a = sb.length
                            sb.append(" ").append(t).append(" ")
                            sb.setSpan(RelativeSizeSpan(0.85f), a, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                            sb.setSpan(ForegroundColorSpan(Color.parseColor("#9E9E9E")), a, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        }
                        val ti = sb.length
                        sb.append(o.optString("title"))
                        sb.setSpan(ForegroundColorSpan(Color.parseColor("#F2F2F2")), ti, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    }
                    if (total > show) {
                        val m = sb.length
                        sb.append("\n+").append((total - show).toString()).append(" weitere")
                        sb.setSpan(ForegroundColorSpan(Color.parseColor("#9E9E9E")), m, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        sb.setSpan(RelativeSizeSpan(0.85f), m, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    }
                } else if (data != null) {
                    val m = sb.length
                    sb.append("\nfrei")
                    sb.setSpan(ForegroundColorSpan(Color.parseColor("#6E6E6E")), m, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                }
                v.setTextViewText(TILES[i], sb)
                v.setInt(TILES[i], "setBackgroundResource", if (isToday) R.drawable.kw_tile_today else R.drawable.kw_tile)
                open(ctx, "day:$ds", 100 + i)?.let { v.setOnClickPendingIntent(TILES[i], it) }
                c.add(Calendar.DAY_OF_YEAR, 1)
            }
            // Achte Kachel: Aufgaben, ein Tipp öffnet die Liste
            val n = data?.optInt("open", 0) ?: 0
            val tb = SpannableStringBuilder()
            tb.append("AUFGABEN")
            tb.setSpan(StyleSpan(Typeface.BOLD), 0, tb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            tb.setSpan(ForegroundColorSpan(Color.parseColor("#BDBDBD")), 0, tb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            val b = tb.length
            tb.append("\n").append(if (n > 0) "$n offen" else "alles erledigt ✓")
            tb.setSpan(StyleSpan(Typeface.BOLD), b, tb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            tb.setSpan(ForegroundColorSpan(Color.parseColor("#FFFFFF")), b, tb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            tb.setSpan(RelativeSizeSpan(1.25f), b, tb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            val m = tb.length
            tb.append("\nantippen zum Ansehen")
            tb.setSpan(ForegroundColorSpan(Color.parseColor("#9E9E9E")), m, tb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            tb.setSpan(RelativeSizeSpan(0.85f), m, tb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            v.setTextViewText(R.id.kd7, tb)
            v.setInt(R.id.kd7, "setBackgroundResource", R.drawable.kw_tile_tasks)
            open(ctx, "tasks", 120)?.let { v.setOnClickPendingIntent(R.id.kd7, it) }

            // Titel: KW und Zeitraum, Tipp öffnet die App bei heute
            val sun = first.clone() as Calendar; sun.add(Calendar.DAY_OF_YEAR, 6)
            val kw = first.apply { minimalDaysInFirstWeek = 4; firstDayOfWeek = Calendar.MONDAY }.get(Calendar.WEEK_OF_YEAR)
            val range = if (first.get(Calendar.MONTH) == sun.get(Calendar.MONTH)) "${first.get(Calendar.DAY_OF_MONTH)}.–${sun.get(Calendar.DAY_OF_MONTH)}. ${MO[sun.get(Calendar.MONTH)]}"
                        else "${first.get(Calendar.DAY_OF_MONTH)}. ${MO[first.get(Calendar.MONTH)]} – ${sun.get(Calendar.DAY_OF_MONTH)}. ${MO[sun.get(Calendar.MONTH)]}"
            v.setTextViewText(R.id.kk_title, "KW $kw  ·  $range")
            open(ctx, "day:$today", 130)?.let { v.setOnClickPendingIntent(R.id.kk_title, it) }
            mgr.updateAppWidget(id, v)
        }
    }
}
