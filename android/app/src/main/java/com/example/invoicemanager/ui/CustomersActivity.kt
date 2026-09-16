package com.example.invoicemanager.ui

import android.os.Bundle
import android.widget.EditText
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
import androidx.lifecycle.lifecycleScope
import com.example.invoicemanager.data.AppDatabase
import com.example.invoicemanager.data.Customer
import com.example.invoicemanager.databinding.ActivityCustomersBinding
import kotlinx.coroutines.launch
import java.util.UUID

class CustomersActivity : AppCompatActivity() {
    private lateinit var binding: ActivityCustomersBinding
    private val adapter = CustomerAdapter()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCustomersBinding.inflate(layoutInflater)
        setContentView(binding.root)
        title = "العملاء"

        binding.recyclerCustomers.adapter = adapter
        val dao = AppDatabase.getInstance(this).customerDao()
        dao.observeAll().observe(this) { adapter.submitList(it) }

        binding.fabAddCustomer.setOnClickListener { showAddCustomerDialog(dao) }
    }

    private fun showAddCustomerDialog(dao: com.example.invoicemanager.data.CustomerDao) {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 16, 32, 0)
        }
        val nameInput = EditText(this).apply { hint = "اسم العميل" }
        val phoneInput = EditText(this).apply { hint = "رقم الهاتف (اختياري)" }
        container.addView(nameInput)
        container.addView(phoneInput)

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
                        )
                    )
                }
            }
            .setNegativeButton("إلغاء", null)
            .show()
    }
}
