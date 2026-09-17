package com.example.invoicemanager.ui

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.example.invoicemanager.data.AppDatabase
import com.example.invoicemanager.data.DuesCalculator
import com.example.invoicemanager.databinding.ActivityMainBinding
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnCustomers.setOnClickListener {
            startActivity(Intent(this, CustomersActivity::class.java))
        }
        binding.btnInvoices.setOnClickListener {
            startActivity(Intent(this, SaleInvoicesActivity::class.java))
        }
        binding.btnDues.setOnClickListener {
            startActivity(Intent(this, DuesActivity::class.java))
        }
        binding.btnSettlements.setOnClickListener {
            startActivity(Intent(this, PaymentsActivity::class.java))
        }
        binding.btnSettings.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
    }

    override fun onResume() {
        super.onResume()
        refreshSummary()
    }

    private fun refreshSummary() {
        val db = AppDatabase.getInstance(this)
        val nf = NumberFormat.getNumberInstance(Locale.US)
        lifecycleScope.launch {
            val s = DuesCalculator.computeDashboard(db)
            binding.textSummaryCounts.text =
                "عدد العملاء: ${s.customersCount}   —   فواتير بيع: ${s.saleInvoicesCount}   —   فواتير شراء: ${s.purchaseInvoicesCount}"
            binding.textSummarySales.text =
                "المبيعات: ${nf.format(s.totalSalesIqd)} د.ع / ${nf.format(s.totalSalesUsd)} $   —   المشتريات: ${nf.format(s.totalPurchasesIqd)} د.ع / ${nf.format(s.totalPurchasesUsd)} $"
            binding.textSummaryDues.text =
                "لنا: ${nf.format(s.totalDuesIqd)} د.ع / ${nf.format(s.totalDuesUsd)} $   —   علينا: ${nf.format(s.totalWeOweIqd)} د.ع / ${nf.format(s.totalWeOweUsd)} $"
        }
    }
}
