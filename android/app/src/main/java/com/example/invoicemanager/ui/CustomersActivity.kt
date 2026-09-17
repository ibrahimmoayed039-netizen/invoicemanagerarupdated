package com.example.invoicemanager.ui

import android.os.Bundle
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
import androidx.lifecycle.lifecycleScope
import com.example.invoicemanager.data.AppDatabase
import com.example.invoicemanager.data.Customer
import com.example.invoicemanager.data.CustomerDao
import com.example.invoicemanager.data.Payment
import com.example.invoicemanager.data.PaymentDao
import com.example.invoicemanager.databinding.ActivityCustomersBinding
import kotlinx.coroutines.launch
import java.util.UUID

class CustomersActivity : AppCompatActivity() {
    private lateinit var binding: ActivityCustomersBinding
    private lateinit var adapter: CustomerAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCustomersBinding.inflate(layoutInflater)
        setContentView(binding.root)
        title = "العملاء"

        val db = AppDatabase.getInstance(this)
        val customerDao = db.customerDao()
        val paymentDao = db.paymentDao()

        adapter = CustomerAdapter(
            onClick = { customer -> startActivity(CustomerStatementActivity.intentFor(this, customer.id)) },
            onLongClick = { customer -> showSettleOpeningDialog(customer, customerDao, paymentDao); true },
        )
        binding.recyclerCustomers.layoutManager = androidx.recyclerview.widget.LinearLayoutManager(this)
        binding.recyclerCustomers.adapter = adapter
        customerDao.observeAll().observe(this) { adapter.submitList(it) }

        binding.fabAddCustomer.setOnClickListener { showAddCustomerDialog(customerDao) }
    }

    private fun showAddCustomerDialog(dao: CustomerDao) {
        val nameInput = EditText(this).apply { hint = "اسم العميل" }
        val phoneInput = EditText(this).apply { hint = "رقم الهاتف (اختياري)" }
        val openingIqdInput = EditText(this).apply {
            hint = "رصيد قديم بالدينار (اختياري)"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL or android.text.InputType.TYPE_NUMBER_FLAG_SIGNED
        }
        val openingUsdInput = EditText(this).apply {
            hint = "رصيد قديم بالدولار (اختياري)"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL or android.text.InputType.TYPE_NUMBER_FLAG_SIGNED
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 16, 32, 0)
            addView(nameInput)
            addView(phoneInput)
            addView(openingIqdInput)
            addView(openingUsdInput)
        }

        AlertDialog.Builder(this)
            .setTitle("عميل جديد")
            .setView(container)
            .setPositiveButton("حفظ") { _, _ ->
                val name = nameInput.text.toString().trim()
                if (name.isEmpty()) return@setPositiveButton
                lifecycleScope.launch {
                    dao.upsert(
                        Customer(
                            id = UUID.randomUUID().toString(),
                            name = name,
                            phone = phoneInput.text.toString().trim(),
                            openingBalanceIqd = openingIqdInput.text.toString().toDoubleOrNull() ?: 0.0,
                            openingBalanceUsd = openingUsdInput.text.toString().toDoubleOrNull() ?: 0.0,
                        )
                    )
                }
            }
            .setNegativeButton("إلغاء", null)
            .show()
    }

    // تسديد من الرصيد القديم مباشرة (بدون فاتورة محددة) — بضغطة مطوّلة على العميل بالقائمة
    private fun showSettleOpeningDialog(customer: Customer, customerDao: CustomerDao, paymentDao: PaymentDao) {
        lifecycleScope.launch {
            val paidIqd = paymentDao.sumOpeningPayments(customer.id, "IQD")
            val paidUsd = paymentDao.sumOpeningPayments(customer.id, "USD")
            val remainingIqd = customer.openingBalanceIqd - paidIqd
            val remainingUsd = customer.openingBalanceUsd - paidUsd

            if (remainingIqd <= 0.001 && remainingUsd <= 0.001) {
                Toast.makeText(this@CustomersActivity, "لا يوجد رصيد قديم مستحق على ${customer.name}", Toast.LENGTH_LONG).show()
                return@launch
            }

            val currencyOptions = mutableListOf<String>()
            if (remainingIqd > 0.001) currencyOptions.add("دينار — المتبقي: $remainingIqd")
            if (remainingUsd > 0.001) currencyOptions.add("دولار — المتبقي: $remainingUsd")

            val currencySpinner = android.widget.Spinner(this@CustomersActivity).apply {
                adapter = android.widget.ArrayAdapter(this@CustomersActivity, android.R.layout.simple_spinner_dropdown_item, currencyOptions)
            }
            val amountInput = EditText(this@CustomersActivity).apply {
                hint = "المبلغ المُسدَّد"
                inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            }
            val container = LinearLayout(this@CustomersActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(32, 16, 32, 0)
                addView(currencySpinner)
                addView(amountInput)
            }

            AlertDialog.Builder(this@CustomersActivity)
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
                        paymentDao.upsert(
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
}
