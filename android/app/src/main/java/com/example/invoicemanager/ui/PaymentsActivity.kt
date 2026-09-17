package com.example.invoicemanager.ui

import android.os.Bundle
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.invoicemanager.data.AppDatabase
import com.example.invoicemanager.data.Customer
import com.example.invoicemanager.data.Payment
import com.example.invoicemanager.data.PurchaseInvoice
import com.example.invoicemanager.data.SaleInvoice
import com.example.invoicemanager.databinding.ActivityPaymentsBinding
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * شاشة "التسديد" المركزية — تعرض كل حركات التسديد (فواتير بيع/شراء + رصيد قديم) من مكان واحد،
 * وتسمح بتسجيل تسديد جديد لأي نوع دون الحاجة للذهاب إلى شاشة الفاتورة أو العميل تحديداً.
 * التسديد لفاتورة محددة ما زال متاحاً أيضاً من داخل شاشتَي الفواتير مباشرة، ومن ضغطة مطوّلة
 * على العميل لتسديد رصيده القديم — هذه الشاشة إضافة مركزية وليست بديلاً عنها.
 */
class PaymentsActivity : AppCompatActivity() {
    private lateinit var binding: ActivityPaymentsBinding
    private lateinit var adapter: PaymentAdapter
    private var customers: List<Customer> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPaymentsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        title = "التسديد"

        val db = AppDatabase.getInstance(this)
        binding.recyclerPayments.layoutManager = LinearLayoutManager(this)

        lifecycleScope.launch {
            customers = db.customerDao().getAllOnce()
            val namesMap = customers.associate { c -> c.id to c.name }
            adapter = PaymentAdapter(
                customerNames = namesMap,
                onLongClick = { payment -> confirmDeletePayment(payment); true },
            )
            binding.recyclerPayments.adapter = adapter
            db.paymentDao().observeAll().observe(this@PaymentsActivity) { list -> adapter.submitList(list) }
        }

        binding.fabAddPayment.setOnClickListener { showAddPaymentMenu() }
    }

    // ---------------- إضافة تسديد جديد ----------------

    private fun showAddPaymentMenu() {
        if (customers.isEmpty()) {
            Toast.makeText(this, "أضف عميلاً واحداً على الأقل أولاً من شاشة العملاء", Toast.LENGTH_LONG).show()
            return
        }
        val options = arrayOf("تسديد فاتورة بيع (عميل يدفع لنا)", "تسديد فاتورة شراء (ندفع لمورّد)", "تسديد رصيد قديم")
        AlertDialog.Builder(this)
            .setTitle("نوع التسديد")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> pickCustomer { customer -> pickUnpaidSaleInvoice(customer) { invoice -> showSaleAmountDialog(customer, invoice) } }
                    1 -> pickCustomer { customer -> pickUnpaidPurchaseInvoice(customer) { invoice -> showPurchaseAmountDialog(customer, invoice) } }
                    2 -> pickCustomer { customer -> showOpeningBalanceDialog(customer) }
                }
            }
            .show()
    }

    private fun pickCustomer(onPicked: (Customer) -> Unit) {
        val names = customers.map { it.name }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("اختر العميل / المورّد")
            .setItems(names) { _, which -> onPicked(customers[which]) }
            .show()
    }

    private fun pickUnpaidSaleInvoice(customer: Customer, onPicked: (SaleInvoice) -> Unit) {
        lifecycleScope.launch {
            val db = AppDatabase.getInstance(this@PaymentsActivity)
            val unpaid = db.saleInvoiceDao().getForCustomerOnce(customer.id).filter { it.remaining > 0.0001 }
            if (unpaid.isEmpty()) {
                Toast.makeText(this@PaymentsActivity, "لا توجد فواتير بيع غير مسددة لهذا العميل", Toast.LENGTH_LONG).show()
                return@launch
            }
            val labels = unpaid.map { "${it.invoiceNumber} — المتبقي: ${it.remaining} ${if (it.currency == "USD") "$" else "د.ع"}" }.toTypedArray()
            AlertDialog.Builder(this@PaymentsActivity)
                .setTitle("اختر فاتورة البيع")
                .setItems(labels) { _, which -> onPicked(unpaid[which]) }
                .show()
        }
    }

    private fun pickUnpaidPurchaseInvoice(customer: Customer, onPicked: (PurchaseInvoice) -> Unit) {
        lifecycleScope.launch {
            val db = AppDatabase.getInstance(this@PaymentsActivity)
            val unpaid = db.purchaseInvoiceDao().getForCustomerOnce(customer.id).filter { it.remaining > 0.0001 }
            if (unpaid.isEmpty()) {
                Toast.makeText(this@PaymentsActivity, "لا توجد فواتير شراء غير مسددة لهذا المورّد", Toast.LENGTH_LONG).show()
                return@launch
            }
            val labels = unpaid.map { "${it.invoiceNumber} — المتبقي: ${it.remaining} ${if (it.currency == "USD") "$" else "د.ع"}" }.toTypedArray()
            AlertDialog.Builder(this@PaymentsActivity)
                .setTitle("اختر فاتورة الشراء")
                .setItems(labels) { _, which -> onPicked(unpaid[which]) }
                .show()
        }
    }

    private fun showSaleAmountDialog(customer: Customer, invoice: SaleInvoice) {
        val unit = if (invoice.currency == "USD") "$" else "د.ع"
        val amountInput = EditText(this).apply {
            hint = "المبلغ (المتبقي: ${invoice.remaining} $unit)"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText(invoice.remaining.toString())
        }
        AlertDialog.Builder(this)
            .setTitle("تسديد ${invoice.invoiceNumber} — ${customer.name}")
            .setView(wrapInput(amountInput))
            .setPositiveButton("تسديد") { _, _ ->
                var amount = amountInput.text.toString().toDoubleOrNull() ?: 0.0
                if (amount <= 0.0) return@setPositiveButton
                if (amount > invoice.remaining) amount = invoice.remaining
                lifecycleScope.launch {
                    val db = AppDatabase.getInstance(this@PaymentsActivity)
                    db.saleInvoiceDao().upsert(invoice.copy(paidAmount = invoice.paidAmount + amount))
                    db.paymentDao().upsert(
                        Payment(
                            id = UUID.randomUUID().toString(),
                            customerId = customer.id,
                            invoiceId = invoice.id,
                            currency = invoice.currency,
                            amount = amount,
                            kind = "sale_payment",
                            date = System.currentTimeMillis(),
                        )
                    )
                }
            }
            .setNegativeButton("إلغاء", null)
            .show()
    }

    private fun showPurchaseAmountDialog(customer: Customer, invoice: PurchaseInvoice) {
        val unit = if (invoice.currency == "USD") "$" else "د.ع"
        val amountInput = EditText(this).apply {
            hint = "المبلغ (المتبقي علينا: ${invoice.remaining} $unit)"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText(invoice.remaining.toString())
        }
        AlertDialog.Builder(this)
            .setTitle("تسديد ${invoice.invoiceNumber} — ${customer.name}")
            .setView(wrapInput(amountInput))
            .setPositiveButton("تسديد") { _, _ ->
                var amount = amountInput.text.toString().toDoubleOrNull() ?: 0.0
                if (amount <= 0.0) return@setPositiveButton
                if (amount > invoice.remaining) amount = invoice.remaining
                lifecycleScope.launch {
                    val db = AppDatabase.getInstance(this@PaymentsActivity)
                    db.purchaseInvoiceDao().upsert(invoice.copy(paidAmount = invoice.paidAmount + amount))
                    db.paymentDao().upsert(
                        Payment(
                            id = UUID.randomUUID().toString(),
                            customerId = customer.id,
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

    private fun showOpeningBalanceDialog(customer: Customer) {
        lifecycleScope.launch {
            val db = AppDatabase.getInstance(this@PaymentsActivity)
            val paidIqd = db.paymentDao().sumOpeningPayments(customer.id, "IQD")
            val paidUsd = db.paymentDao().sumOpeningPayments(customer.id, "USD")
            val remainingIqd = customer.openingBalanceIqd - paidIqd
            val remainingUsd = customer.openingBalanceUsd - paidUsd

            if (remainingIqd <= 0.001 && remainingUsd <= 0.001) {
                Toast.makeText(this@PaymentsActivity, "لا يوجد رصيد قديم مستحق على ${customer.name}", Toast.LENGTH_LONG).show()
                return@launch
            }

            val currencyOptions = mutableListOf<String>()
            if (remainingIqd > 0.001) currencyOptions.add("دينار — المتبقي: $remainingIqd")
            if (remainingUsd > 0.001) currencyOptions.add("دولار — المتبقي: $remainingUsd")

            val currencySpinner = android.widget.Spinner(this@PaymentsActivity).apply {
                adapter = android.widget.ArrayAdapter(this@PaymentsActivity, android.R.layout.simple_spinner_dropdown_item, currencyOptions)
            }
            val amountInput = EditText(this@PaymentsActivity).apply {
                hint = "المبلغ المُسدَّد"
                inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            }
            val container = LinearLayout(this@PaymentsActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(32, 16, 32, 0)
                addView(currencySpinner)
                addView(amountInput)
            }

            AlertDialog.Builder(this@PaymentsActivity)
                .setTitle("تسديد رصيد قديم — ${customer.name}")
                .setView(container)
                .setPositiveButton("تسديد") { _, _ ->
                    val pickedIqd = (currencySpinner.selectedItem as String).startsWith("دينار")
                    val currency = if (pickedIqd) "IQD" else "USD"
                    val remaining = if (pickedIqd) remainingIqd else remainingUsd
                    var amount = amountInput.text.toString().toDoubleOrNull() ?: 0.0
                    if (amount <= 0.0) return@setPositiveButton
                    if (amount > remaining) amount = remaining
                    lifecycleScope.launch {
                        db.paymentDao().upsert(
                            Payment(
                                id = UUID.randomUUID().toString(),
                                customerId = customer.id,
                                invoiceId = null,
                                currency = currency,
                                amount = amount,
                                kind = "opening_payment",
                                date = System.currentTimeMillis(),
                            )
                        )
                    }
                }
                .setNegativeButton("إلغاء", null)
                .show()
        }
    }

    // ---------------- حذف تسديد (مع عكس أثره على الفاتورة المرتبطة إن وُجدت) ----------------

    private fun confirmDeletePayment(payment: Payment) {
        AlertDialog.Builder(this)
            .setTitle("حذف حركة تسديد")
            .setMessage("سيتم حذف هذه الحركة، وإعادة المبلغ إلى \"غير مسدد\" على الفاتورة المرتبطة (إن وُجدت). هل تريد المتابعة؟")
            .setPositiveButton("حذف") { _, _ ->
                lifecycleScope.launch {
                    val db = AppDatabase.getInstance(this@PaymentsActivity)
                    when (payment.kind) {
                        "sale_payment" -> payment.invoiceId?.let { id ->
                            db.saleInvoiceDao().getById(id)?.let { inv ->
                                db.saleInvoiceDao().upsert(inv.copy(paidAmount = (inv.paidAmount - payment.amount).coerceAtLeast(0.0)))
                            }
                        }
                        "purchase_payment" -> payment.invoiceId?.let { id ->
                            db.purchaseInvoiceDao().getById(id)?.let { inv ->
                                db.purchaseInvoiceDao().upsert(inv.copy(paidAmount = (inv.paidAmount - payment.amount).coerceAtLeast(0.0)))
                            }
                        }
                        // opening_payment: لا شيء إضافي — المتبقي يُحسب دائماً من (الأصل − مجموع التسديدات)
                    }
                    db.paymentDao().delete(payment)
                }
            }
            .setNegativeButton("إلغاء", null)
            .show()
    }

    private fun wrapInput(view: android.view.View) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(32, 16, 32, 0)
        addView(view)
    }
}
