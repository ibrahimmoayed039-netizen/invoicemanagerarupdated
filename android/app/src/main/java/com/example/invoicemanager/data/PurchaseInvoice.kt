package com.example.invoicemanager.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * يقابل فاتورة الشراء بنسخة سطح المكتب (db.js: purchaseInvoices) — نفس حقول فاتورة البيع
 * تماماً، لكن customerId هنا يشير إلى "المورّد" (نفس جدول العملاء يُستخدم كعملاء وموردين معاً،
 * تماماً كما بنسخة سطح المكتب). paidAmount = ما دفعناه نحن للمورّد، وremaining = ما تبقى علينا له.
 */
@Entity(tableName = "purchase_invoices")
data class PurchaseInvoice(
    @PrimaryKey val id: String,
    val invoiceNumber: String,
    val customerId: String, // المورّد
    val currency: String = "IQD", // "IQD" أو "USD"
    val total: Double,
    val discount: Double = 0.0,
    val paidAmount: Double = 0.0,
    val notes: String = "",
    val date: Long = System.currentTimeMillis(),
) {
    val remaining: Double get() = total - paidAmount
    val status: String get() = when {
        remaining <= 0.001 -> "paid"
        paidAmount > 0.001 -> "partial"
        else -> "unpaid"
    }
}
