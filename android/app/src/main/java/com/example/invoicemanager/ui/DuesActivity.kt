package com.example.invoicemanager.ui

import android.os.Bundle
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.example.invoicemanager.R
import com.example.invoicemanager.data.AppDatabase
import com.example.invoicemanager.data.DuesCalculator
import com.example.invoicemanager.databinding.ActivityDuesBinding
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

class DuesActivity : AppCompatActivity() {
    private lateinit var binding: ActivityDuesBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityDuesBinding.inflate(layoutInflater)
        setContentView(binding.root)
        title = "المستحقات"

        val db = AppDatabase.getInstance(this)
        val nf = NumberFormat.getNumberInstance(Locale.US)

        lifecycleScope.launch {
            val dues = DuesCalculator.computeDues(db)
            val totalTheyOweIqd = dues.sumOf { it.theyOweUsIqd }
            val totalTheyOweUsd = dues.sumOf { it.theyOweUsUsd }
            val totalWeOweIqd = dues.sumOf { it.weOweThemIqd }
            val totalWeOweUsd = dues.sumOf { it.weOweThemUsd }
            binding.textTotals.text =
                "لنا (على العملاء): ${nf.format(totalTheyOweIqd)} د.ع  /  ${nf.format(totalTheyOweUsd)} $\n" +
                "علينا (للموردين): ${nf.format(totalWeOweIqd)} د.ع  /  ${nf.format(totalWeOweUsd)} $"

            binding.containerDues.removeAllViews()
            if (dues.isEmpty()) {
                binding.containerDues.addView(TextView(this@DuesActivity).apply {
                    text = "لا توجد مستحقات حالياً 🎉"
                    setPadding(8, 24, 8, 8)
                })
                return@launch
            }
            dues.sortedByDescending { it.theyOweUsIqd + it.theyOweUsUsd + it.weOweThemIqd + it.weOweThemUsd }.forEach { d ->
                // مستحق لنا من هذا العميل يُلوَّن بلون "غير مسددة"، ومستحق علينا لهذا المورّد
                // (فواتير شراء) يُلوَّن بلون "جزئية" للتفريق البصري بين الاتجاهين.
                val weOweSomething = d.weOweThemIqd > 0.0001 || d.weOweThemUsd > 0.0001
                val tintColor = if (weOweSomething && d.theyOweUsIqd <= 0.0001 && d.theyOweUsUsd <= 0.0001) R.color.tint_partial else R.color.tint_unpaid
                val fgColor = if (weOweSomething && d.theyOweUsIqd <= 0.0001 && d.theyOweUsUsd <= 0.0001) R.color.status_partial else R.color.status_unpaid

                val row = LinearLayout(this@DuesActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(20, 14, 20, 14)
                    setBackgroundColor(ContextCompat.getColor(context, tintColor))
                    isClickable = true
                    isFocusable = true
                    setOnClickListener {
                        startActivity(CustomerStatementActivity.intentFor(this@DuesActivity, d.customerId))
                    }
                }
                row.addView(TextView(this@DuesActivity).apply {
                    text = d.customerName
                    textSize = 15f
                    setTypeface(typeface, android.graphics.Typeface.BOLD)
                    setTextColor(ContextCompat.getColor(context, fgColor))
                })
                if (d.theyOweUsIqd > 0.0001 || d.theyOweUsUsd > 0.0001) {
                    val parts = mutableListOf<String>()
                    if (d.theyOweUsIqd > 0.0001) parts.add("${nf.format(d.theyOweUsIqd)} د.ع")
                    if (d.theyOweUsUsd > 0.0001) parts.add("${nf.format(d.theyOweUsUsd)} $")
                    row.addView(TextView(this@DuesActivity).apply {
                        text = "مستحق لنا: ${parts.joinToString("  —  ")}"
                        textSize = 13f
                        setTextColor(0xFF555555.toInt())
                    })
                }
                if (weOweSomething) {
                    val parts = mutableListOf<String>()
                    if (d.weOweThemIqd > 0.0001) parts.add("${nf.format(d.weOweThemIqd)} د.ع")
                    if (d.weOweThemUsd > 0.0001) parts.add("${nf.format(d.weOweThemUsd)} $")
                    row.addView(TextView(this@DuesActivity).apply {
                        text = "مستحق علينا له (كمورّد): ${parts.joinToString("  —  ")}"
                        textSize = 13f
                        setTextColor(0xFF555555.toInt())
                    })
                }
                val params = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                params.bottomMargin = 6
                binding.containerDues.addView(row, params)
            }
        }
    }
}
