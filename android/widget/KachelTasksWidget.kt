package ch.kachelkalender.app

// Startbildschirm-Widget «Aufgaben»: alle offenen Aufgaben auf einen Blick
// (eigene und aus Todoist), gruppiert nach Überfällig, Heute, Diese Woche, Später.
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
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

class KachelTasksWidget : AppWidgetProvider() {
    // Zeigt jetzt die Woche als Kacheln (mit Aufgaben-Kachel), damit bereits platzierte Widgets gleich mitwechseln
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) KachelWeekWidget.draw(ctx, mgr, id)
    }

    override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, opts: android.os.Bundle) {
        KachelWeekWidget.draw(ctx, mgr, id)
    }

    companion object {
        @JvmStatic
        fun refresh(ctx: Context) {
            try {
                val mgr = AppWidgetManager.getInstance(ctx)
                val ids = mgr.getAppWidgetIds(ComponentName(ctx, KachelTasksWidget::class.java))
                for (id in ids) KachelWeekWidget.draw(ctx, mgr, id)
            } catch (e: Exception) { }
        }

        fun findFile(ctx: Context, name: String): File? {
            for (root in listOf(ctx.dataDir, ctx.filesDir)) {
                try {
                    val hit = root.walkTopDown().maxDepth(4).firstOrNull { it.name == name }
                    if (hit != null) return hit
                } catch (e: Exception) { }
            }
            return null
        }

        private fun draw(ctx: Context, mgr: AppWidgetManager, id: Int) {
            val v = RemoteViews(ctx.packageName, R.layout.kachel_tasks_widget)
            val sb = SpannableStringBuilder()
            var open = 0
            try {
                val f = findFile(ctx, "kk-tasks.json")
                if (f != null) {
                    val arr = JSONArray(f.readText())
                    open = arr.length()
                    var lastGroup = ""
                    val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT)
                    val cal = java.util.Calendar.getInstance()
                    val today = fmt.format(cal.time); cal.add(java.util.Calendar.DAY_OF_YEAR, 7); val week = fmt.format(cal.time)
                    val items = (0 until arr.length()).map { arr.getJSONObject(it) }.map { o ->
                        val due = o.optString("due")
                        // Gruppe jedes Mal neu bestimmen, damit sie nach Mitternacht stimmt
                        val g = if (o.optBoolean("nodue")) 4 else if (due < today) 0 else if (due == today) 1 else if (due <= week) 2 else 3
                        Pair(g, o)
                    }.sortedWith(compareBy({ it.first }, { it.second.optString("due") }))
                    val names = listOf("Überfällig", "Heute", "Diese Woche", "Später", "Ohne Datum")
                    var n = 0
                    for ((gi, o) in items) {
                        val g = names[gi]
                        if (g != lastGroup) {
                            if (sb.isNotEmpty()) sb.append("\n")
                            val s = sb.length
                            sb.append(g.uppercase()).append("\n")
                            sb.setSpan(StyleSpan(Typeface.BOLD), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                            sb.setSpan(RelativeSizeSpan(0.8f), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                            sb.setSpan(ForegroundColorSpan(Color.parseColor(if (g == "Überfällig") "#FFFFFF" else "#9E9E9E")), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                            lastGroup = g
                        }
                        val b = sb.length
                        sb.append("○ ")
                        sb.setSpan(ForegroundColorSpan(Color.parseColor("#FFFFFF")), b, b + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        sb.append(o.optString("title"))
                        val meta = o.optString("meta")
                        if (meta.isNotEmpty()) {
                            val m = sb.length
                            sb.append("  ").append(meta)
                            sb.setSpan(ForegroundColorSpan(Color.parseColor("#9E9E9E")), m, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                            sb.setSpan(RelativeSizeSpan(0.85f), m, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        }
                        sb.append("\n")
                        n++
                        if (n >= 14) break
                    }
                }
            } catch (e: Exception) { }
            if (sb.isEmpty()) sb.append("Alles erledigt ✓")
            v.setTextViewText(R.id.kt_title, if (open > 0) "Aufgaben · $open offen" else "Aufgaben")
            v.setTextViewText(R.id.kt_list, sb.trimEnd())
            val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            if (launch != null) {
                launch.putExtra("kk_open", "tasks")
                launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                v.setOnClickPendingIntent(R.id.kt_root, PendingIntent.getActivity(ctx, 1, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            }
            mgr.updateAppWidget(id, v)
        }

        // Wunsch des Widgets an die App weitergeben (die App holt ihn beim Öffnen ab)
        @JvmStatic
        fun handleIntent(ctx: Context, intent: Intent?) {
            val what = intent?.getStringExtra("kk_open") ?: return
            intent.removeExtra("kk_open")
            try {
                val dir = (findFile(ctx, "kk-tasks.json") ?: findFile(ctx, "kk-widget.json"))?.parentFile ?: return
                File(dir, "kk-open.txt").writeText(what)
            } catch (e: Exception) { }
        }
    }
}
