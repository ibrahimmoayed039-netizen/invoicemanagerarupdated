package com.example.invoicemanager.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.example.invoicemanager.R
import com.example.invoicemanager.data.AppDatabase
import com.example.invoicemanager.data.Customer
import com.example.invoicemanager.data.PurchaseInvoice
import com.example.invoicemanager.databinding.ActivityCustomerStatementBinding
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * حركة بدفتر حساب العميل — تقابل نفس منطق buildCustomerLedger بنسخة سطح المكتب (db.js/app.js):
 * "حساب قديم" يُثبَّت دائماً كأول حركة زمنياً (sortDate ثابت قديم جداً، بينما date هو التاريخ المعروض
 * الفعلي)، ثم فواتير البيع (مدين) والتسديدات (دائن) مرتبة حسب التاريخ الفعلي، مع رصيد متراكم.
 */
private data class LedgerEvent(
    val displayDate: Long,
    val sortDate: Long,
    val label: String,
    val kind: String, // opening | invoice | payment
    val amount: Double, // موجب = مدين (يزيد المستحق)، سالب = دائن (يقلّل المستحق)
)

class CustomerStatementActivity : AppCompatActivity() {
    companion object {
        private const val EXTRA_CUSTOMER_ID = "extra_customer_id"
        fun intentFor(context: Context, customerId: String) =
            Intent(context, CustomerStatementActivity::class.java).putExtra(EXTRA_CUSTOMER_ID, customerId)
    }

    private lateinit var binding: ActivityCustomerStatementBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCustomerStatementBinding.inflate(layoutInflater)
        setContentView(binding.root)
        title = "كشف حساب"

        val customerId = intent.getStringExtra(EXTRA_CUSTOMER_ID) ?: return
        val db = AppDatabase.getInstance(this)

        lifecycleScope.launch {
            val customer = db.customerDao().getById(customerId) ?: return@launch
            val invoices = db.saleInvoiceDao().getForCustomerOnce(customerId)
            // نستثني تسديدات فواتير الشراء من دفتر "المستحق لنا" لأنها حركة مستقلة تخص
            // دفتر "المستحق علينا" (المشتريات)، وليست جزءاً من حساب العميل كعميل يشتري منا.
            val payments = db.paymentDao().getForCustomerOnce(customerId).filter { it.kind != "purchase_payment" }

            binding.textCustomerName.text = customer.name

            renderLedger(binding.containerIqd, buildLedger(customer, invoices, payments, "IQD"), "IQD")
            renderLedger(binding.containerUsd, buildLedger(customer, invoices, payments, "USD"), "USD")

            // دفتر المشتريات (ما ندين نحن به لهذا الطرف كمورّد) — يظهر فقط إن وُجدت أي فواتير شراء له
            val purchaseInvoices = db.purchaseInvoiceDao().getForCustomerOnce(customerId)
            val purchasePayments = db.paymentDao().getForCustomerOnce(customerId).filter { it.kind == "purchase_payment" }
            if (purchaseInvoices.isNotEmpty()) {
                binding.purchaseSection.visibility = android.view.View.VISIBLE
                renderLedger(binding.containerPurchaseIqd, buildPurchaseLedger(purchaseInvoices, purchasePayments, "IQD"), "IQD")
                renderLedger(binding.containerPurchaseUsd, buildPurchaseLedger(purchaseInvoices, purchasePayments, "USD"), "USD")
            }
        }
    }

    private fun buildLedger(
        customer: Customer,
        invoices: List<com.example.invoicemanager.data.SaleInvoice>,
        payments: List<com.example.invoicemanager.data.Payment>,
        currency: String,
    ): List<LedgerEvent> {
        val events = mutableListOf<LedgerEvent>()
        val opening = if (currency == "USD") customer.openingBalanceUsd else customer.openingBalanceIqd
        if (opening != 0.0) {
            events.add(LedgerEvent(customer.createdAt, 0L, "حساب قديم", "opening", opening))
        }
        invoices.filter { it.currency == currency }.forEach { inv ->
            events.add(LedgerEvent(inv.date, inv.date, "فاتورة بيع ${inv.invoiceNumber}", "invoice", inv.total))
        }
        payments.filter { it.currency == currency }.forEach { p ->
            val label = if (p.kind == "opening_payment") "تسديد رصيد قديم" else "تسديد"
            events.add(LedgerEvent(p.date, p.date, label, "payment", -p.amount))
        }
        return events.sortedBy { it.sortDate }
    }

    // دفتر المشتريات: فاتورة الشراء تزيد ما ندين به (مدين)، وتسديدنا للمورّد يقلّله (دائن) — نفس منطق
    // دفتر المبيعات لكن بدون "حساب قديم" لأن الرصيد القديم بهذه النسخة يخص علاقة العميل بنا فقط.
    private fun buildPurchaseLedger(
        invoices: List<PurchaseInvoice>,
        payments: List<com.example.invoicemanager.data.Payment>,
        currency: String,
    ): List<LedgerEvent> {
        val events = mutableListOf<LedgerEvent>()
        invoices.filter { it.currency == currency }.forEach { inv ->
            events.add(LedgerEvent(inv.date, inv.date, "فاتورة شراء ${inv.invoiceNumber}", "invoice", inv.total))
        }
        payments.filter { it.currency == currency }.forEach { p ->
            events.add(LedgerEvent(p.date, p.date, "تسديد للمورّد", "payment", -p.amount))
        }
        return events.sortedBy { it.sortDate }
    }

    private fun renderLedger(container: LinearLayout, events: List<LedgerEvent>, currency: String) {
        container.removeAllViews()
        if (events.isEmpty()) {
            val empty = TextView(this).apply {
                text = "لا توجد حركات بهذه العملة"
                setTextColor(0xFF999999.toInt())
                setPadding(8, 8, 8, 16)
            }
            container.addView(empty)
            return
        }
        val nf = NumberFormat.getNumberInstance(Locale.US)
        val df = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val unit = if (currency == "USD") "$" else "د.ع"
        var running = 0.0
        events.forEach { e ->
            running += e.amount
            val bgRes: Int
            val fgRes: Int
            when (e.kind) {
                "opening" -> { bgRes = R.color.tint_partial; fgRes = R.color.status_partial }
                "invoice" -> { bgRes = R.color.tint_unpaid; fgRes = R.color.status_unpaid }
                else -> { bgRes = R.color.tint_paid; fgRes = R.color.status_paid }
            }
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(20, 14, 20, 14)
                setBackgroundColor(ContextCompat.getColor(context, bgRes))
            }
            val line1 = TextView(this).apply {
                text = e.label
                textSize = 14f
                setTextColor(ContextCompat.getColor(context, fgRes))
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }
            val amountText = if (e.amount >= 0) "+${nf.format(e.amount)}" else nf.format(e.amount)
            val line2 = TextView(this).apply {
                text = "${df.format(Date(e.displayDate))} — $amountText $unit — الرصيد بعدها: ${nf.format(running)} $unit"
                textSize = 12f
                setTextColor(0xFF555555.toInt())
            }
            row.addView(line1)
            row.addView(line2)
            val marginParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            marginParams.bottomMargin = 6
            container.addView(row, marginParams)
        }
        val totalLabel = TextView(this).apply {
            text = "الرصيد النهائي: ${nf.format(running)} $unit"
            textSize = 14f
            gravity = Gravity.END
            setPadding(8, 12, 8, 8)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        container.addView(totalLabel)
    }
}
