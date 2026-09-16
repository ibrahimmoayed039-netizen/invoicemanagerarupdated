package com.example.invoicemanager.ui

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.example.invoicemanager.databinding.ActivityMainBinding

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
            startActivity(PlaceholderActivity.intentFor(this, "الفواتير"))
        }
        binding.btnSettlements.setOnClickListener {
            startActivity(PlaceholderActivity.intentFor(this, "التسديد"))
        }
        binding.btnSettings.setOnClickListener {
            startActivity(PlaceholderActivity.intentFor(this, "الإعدادات"))
        }
    }
}
