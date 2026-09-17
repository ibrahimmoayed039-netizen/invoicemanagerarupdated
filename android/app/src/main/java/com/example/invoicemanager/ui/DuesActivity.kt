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
            val totalIqd = dues.sumOf { it.theyOweUsIqd }
            val totalUsd = dues.sumOf { it.theyOweUsUsd }
            binding.textTotals.text = "إجمالي المستحقات — ${nf.format(totalIqd)} د.ع  /  ${nf.format(totalUsd)} $"

            binding.containerDues.removeAllViews()
            if (dues.isEmpty()) {
                binding.containerDues.addView(TextView(this@DuesActivity).apply {
                    text = "لا توجد مستحقات حالياً 🎉"
                    setPadding(8, 24, 8, 8)
                })
                return@launch
            }
            dues.sortedByDescending { it.theyOweUsIqd + it.theyOweUsUsd }.forEach { d ->
                val row = LinearLayout(this@DuesActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(20, 14, 20, 14)
                    setBackgroundColor(ContextCompat.getColor(context, R.color.tint_unpaid))
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
                    setTextColor(ContextCompat.getColor(context, R.color.status_unpaid))
                })
                val parts = mutableListOf<String>()
                if (d.theyOweUsIqd > 0.0001) parts.add("${nf.format(d.theyOweUsIqd)} د.ع")
                if (d.theyOweUsUsd > 0.0001) parts.add("${nf.format(d.theyOweUsUsd)} $")
                row.addView(TextView(this@DuesActivity).apply {
                    text = "مستحق: ${parts.joinToString("  —  ")}"
                    textSize = 13f
                    setTextColor(0xFF555555.toInt())
                })
                val params = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                params.bottomMargin = 6
                binding.containerDues.addView(row, params)
            }
        }
    }
}
