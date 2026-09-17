package com.example.invoicemanager.ui

import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.example.invoicemanager.data.AppDatabase
import com.example.invoicemanager.data.AppSettings
import com.example.invoicemanager.databinding.ActivitySettingsBinding
import kotlinx.coroutines.launch

/**
 * شاشة الإعدادات — تقابل تبويب الإعدادات بنسخة سطح المكتب: بيانات المنشأة
 * (الاسم/الهاتف/العنوان) واسم العملة المعروض بجانب مبالغ الدينار.
 *
 * ملاحظة: شعار المنشأة والنسخ الاحتياطي (تصدير/استيراد JSON) غير موجودين
 * هنا بعد — هذي نواقص منفصلة ستُضاف لاحقاً.
 */
class SettingsActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySettingsBinding

    private val currencyOptions = listOf("د.ع", "دينار", "ريال", "دولار", "جنيه", "درهم")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        title = "الإعدادات"

        binding.spinnerCurrency.adapter =
            ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, currencyOptions)

        val dao = AppDatabase.getInstance(this).appSettingsDao()

        lifecycleScope.launch {
            val settings = dao.get() ?: AppSettings()
            binding.inputCompanyName.setText(settings.companyName)
            binding.inputCompanyPhone.setText(settings.companyPhone)
            binding.inputCompanyAddress.setText(settings.companyAddress)
            val currencyIndex = currencyOptions.indexOf(settings.currency).let { if (it >= 0) it else 0 }
            binding.spinnerCurrency.setSelection(currencyIndex)
        }

        binding.btnSaveSettings.setOnClickListener {
            val settings = AppSettings(
                id = 1,
                companyName = binding.inputCompanyName.text?.toString()?.trim() ?: "",
                companyPhone = binding.inputCompanyPhone.text?.toString()?.trim() ?: "",
                companyAddress = binding.inputCompanyAddress.text?.toString()?.trim() ?: "",
                currency = binding.spinnerCurrency.selectedItem as? String ?: "د.ع",
            )
            lifecycleScope.launch {
                dao.upsert(settings)
                Toast.makeText(this@SettingsActivity, "تم حفظ الإعدادات", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
