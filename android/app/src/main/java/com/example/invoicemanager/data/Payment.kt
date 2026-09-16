package com.example.invoicemanager.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * يقابل حركة "تسديد" — قد تكون تسديد فاتورة محددة (invoiceId != null)
 * أو تسديد من الرصيد القديم مباشرة (invoiceId == null، kind = "opening_payment").
 */
@Entity(tableName = "payments")
data class Payment(
    @PrimaryKey val id: String,
    val customerId: String,
    val invoiceId: String? = null,
    val currency: String = "IQD",
    val amount: Double,
    val kind: String = "sale_payment", // sale_payment | opening_payment
    val notes: String = "",
    val date: Long = System.currentTimeMillis(),
)
