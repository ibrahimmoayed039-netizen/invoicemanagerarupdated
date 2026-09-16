package com.example.invoicemanager.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/** يقابل فاتورة البيع بنسخة سطح المكتب — رقم الفاتورة، العميل، الإجمالي، المدفوع، والعملة. */
@Entity(tableName = "sale_invoices")
data class SaleInvoice(
    @PrimaryKey val id: String,
    val invoiceNumber: String,
    val customerId: String,
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
