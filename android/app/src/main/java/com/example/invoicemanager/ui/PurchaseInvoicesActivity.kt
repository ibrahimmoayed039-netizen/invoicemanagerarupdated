package com.example.invoicemanager.ui

import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.invoicemanager.data.AppDatabase
import com.example.invoicemanager.data.Customer
import com.example.invoicemanager.data.Payment
import com.example.invoicemanager.data.PaymentDao
import com.example.invoicemanager.data.PurchaseInvoice
import com.example.invoicemanager.data.PurchaseInvoiceDao
import com.example.invoicemanager.databinding.ActivityPurchaseInvoicesBinding
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * فواتير الشراء — نفس منطق فواتير البيع تماماً، لكن العميل هنا يمثّل "المورّد"، والمبلغ المتبقي
 * يمثّل ما نحن ندين به له (بدل ما يدين هو لنا). تُستخدم نفس قائمة العملاء كموردين، تماماً كنسخة
 * سطح المكتب.
 */
class PurchaseInvoicesActivity : AppCompatActivity() {
    private lateinit var binding: ActivityPurchaseInvoicesBinding
    private lateinit var adapter: PurchaseInvoiceAdapter
    private var customers: List<Customer> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPurchaseInvoicesBinding.inflate(layoutInflater)
        setContentView(binding.root)
        title = "فواتير الشراء"

        val db = AppDatabase.getInstance(this)
        val invoiceDao = db.purchaseInvoiceDao()
        val customerDao = db.customerDao()
        val paymentDao = db.paymentDao()

        binding.recyclerInvoices.layoutManager = LinearLayoutManager(this)

        lifecycleScope.launch {
            customers = customerDao.getAllOnce()
            val namesMap = customers.associate { c -> c.id to c.name }
            adapter = PurchaseInvoiceAdapter(
                customerNames = namesMap,
                onClick = { invoice -> showInvoiceDialog(existing = invoice) },
                onLongClick = { invoice ->
                    lifecycleScope.launch { invoiceDao.delete(invoice) }
                    true
                },
                onSettle = { invoice -> showSettleDialog(invoice, invoiceDao, paymentDao) },
            )
            binding.recyclerInvoices.adapter = adapter
            invoiceDao.observeAll().observe(this@PurchaseInvoicesActivity) { list -> adapter.submitList(list) }
        }

        binding.fabAddInvoice.setOnClickListener {
            if (customers.isEmpty()) {
                android.widget.Toast.makeText(this, "أضف عميلاً (مورّداً) واحداً على الأقل أولاً من شاشة العملاء", android.widget.Toast.LENGTH_LONG).show()
            } else {
                showInvoiceDialog(existing = null)
            }
        }

        // شريط التبديل بين فواتير البيع والشراء — هذه الشاشة نفسها تمثل تبويب "الشراء"
        binding.btnTabSale.setOnClickListener {
            startActivity(Intent(this, SaleInvoicesActivity::class.java))
            finish()
        }
    }

    private fun showInvoiceDialog(existing: PurchaseInvoice?) {
        val db = AppDatabase.getInstance(this)
        val invoiceDao = db.purchaseInvoiceDao()
        val isEdit = existing != null

        val customerNamesArr = customers.map { it.name }.toTypedArray()
        val customerSpinner = Spinner(this).apply {
            adapter = ArrayAdapter(this@PurchaseInvoicesActivity, android.R.layout.simple_spinner_dropdown_item, customerNamesArr)
        }
        val existingCustomerIndex = customers.indexOfFirst { it.id == existing?.customerId }
        if (existingCustomerIndex >= 0) customerSpinner.setSelection(existingCustomerIndex)

        val currencyOptions = arrayOf("د.ع (IQD)", "دولار (USD)")
        val currencySpinner = Spinner(this).apply {
            adapter = ArrayAdapter(this@PurchaseInvoicesActivity, android.R.layout.simple_spinner_dropdown_item, currencyOptions)
        }
        if (existing?.currency == "USD") currencySpinner.setSelection(1)

        val totalInput = EditText(this).apply {
            hint = "الإجمالي"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            existing?.let { setText(it.total.toString()) }
        }
        val discountInput = EditText(this).apply {
            hint = "الخصم (اختياري)"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            existing?.let { if (it.discount != 0.0) setText(it.discount.toString()) }
        }
        val paidInput = EditText(this).apply {
            hint = if (isEdit) "المبلغ المدفوع للمورّد" else "دفعة أولية للمورّد (اختياري)"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            existing?.let { if (it.paidAmount != 0.0) setText(it.paidAmount.toString()) }
        }
        val notesInput = EditText(this).apply {
            hint = "ملاحظات (اختياري)"
            existing?.let { setText(it.notes) }
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 16, 32, 0)
            addView(labelFor("المورّد"))
            addView(customerSpinner)
            addView(labelFor("العملة"))
            addView(currencySpinner)
            addView(totalInput)
            addView(discountInput)
            addView(paidInput)
            addView(notesInput)
        }

        AlertDialog.Builder(this)
            .setTitle(if (isEdit) "تعديل فاتورة شراء" else "فاتورة شراء جديدة")
            .setView(android.widget.ScrollView(this).apply { addView(container) })
            .setPositiveButton(if (isEdit) "حفظ" else "إضافة") { _, _ ->
                val total = totalInput.text.toString().toDoubleOrNull() ?: 0.0
                if (total <= 0.0) return@setPositiveButton
                val selectedCustomer = customers.getOrNull(customerSpinner.selectedItemPosition) ?: return@setPositiveButton
                val currency = if (currencySpinner.selectedItemPosition == 1) "USD" else "IQD"
                val discount = discountInput.text.toString().toDoubleOrNull() ?: 0.0
                val paid = paidInput.text.toString().toDoubleOrNull() ?: 0.0
                val notes = notesInput.text.toString().trim()

                lifecycleScope.launch {
                    if (isEdit && existing != null) {
                        invoiceDao.upsert(
                            existing.copy(
                                customerId = selectedCustomer.id,
                                currency = currency,
                                total = total,
                                discount = discount,
                                paidAmount = paid,
                                notes = notes,
                            )
                        )
                    } else {
                        val count = invoiceDao.count()
                        val invoiceNumber = "P-" + String.format("%04d", count + 1)
                        invoiceDao.upsert(
                            PurchaseInvoice(
                                id = UUID.randomUUID().toString(),
                                invoiceNumber = invoiceNumber,
                                customerId = selectedCustomer.id,
                                currency = currency,
                                total = total,
                                discount = discount,
                                paidAmount = paid,
                                notes = notes,
                                date = System.currentTimeMillis(),
                            )
                        )
                    }
                }
            }
            .setNegativeButton("إلغاء", null)
            .show()
    }

    private fun showSettleDialog(invoice: PurchaseInvoice, invoiceDao: PurchaseInvoiceDao, paymentDao: PaymentDao) {
        val unit = if (invoice.currency == "USD") "$" else "د.ع"
        val amountInput = EditText(this).apply {
            hint = "المبلغ (المتبقي علينا: ${invoice.remaining} $unit)"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText(invoice.remaining.toString())
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 16, 32, 0)
            addView(labelFor("فاتورة ${invoice.invoiceNumber} — المتبقي علينا حالياً: ${invoice.remaining} $unit"))
            addView(amountInput)
        }
        AlertDialog.Builder(this)
            .setTitle("تسديد فاتورة شراء")
            .setView(container)
            .setPositiveButton("تسديد") { _, _ ->
                var amount = amountInput.text.toString().toDoubleOrNull() ?: 0.0
                if (amount <= 0.0) return@setPositiveButton
                if (amount > invoice.remaining) amount = invoice.remaining
                lifecycleScope.launch {
                    invoiceDao.upsert(invoice.copy(paidAmount = invoice.paidAmount + amount))
                    paymentDao.upsert(
                        Payment(
                            id = UUID.randomUUID().toString(),
                            customerId = invoice.customerId,
                            invoiceId = invoice.id,
                            currency = invoice.currency,
                            amount = amount,
                            kind = "purchase_payment",
                            date = System.currentTimeMillis(),
                        )
                    )
                }
            }
            .setNegativeButton("إلغاء", null)
            .show()
    }

    private fun labelFor(text: String) = android.widget.TextView(this).apply {
        this.text = text
        setPadding(0, 16, 0, 4)
        textSize = 13f
    }
}
