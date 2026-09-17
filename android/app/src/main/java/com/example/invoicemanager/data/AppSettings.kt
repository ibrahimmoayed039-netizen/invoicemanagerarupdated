package com.example.invoicemanager.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * إعدادات عامة للبرنامج — صف واحد ثابت (id = 1) يقابل إعدادات المنشأة
 * الموجودة بنسخة سطح المكتب (settings.get/update بـ db.js): اسم المنشأة،
 * الهاتف، العنوان، واسم العملة المعروض بجانب المبالغ.
 *
 * ملاحظة: الشعار (companyLogo) والنسخ الاحتياطي غير مضافين هنا بعد —
 * سيُضافان مع ميزة النسخ الاحتياطي لاحقاً.
 */
@Entity(tableName = "app_settings")
data class AppSettings(
    @PrimaryKey val id: Int = 1,
    val companyName: String = "",
    val companyPhone: String = "",
    val companyAddress: String = "",
    val currency: String = "د.ع",
)
