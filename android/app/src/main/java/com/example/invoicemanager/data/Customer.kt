package com.example.invoicemanager.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * يقابل حقول العميل بنسخة سطح المكتب (db.js: addCustomer) — الاسم، الهاتف،
 * والرصيد القديم بكل عملة (قبل استخدام البرنامج) بالدينار والدولار كل عملة مستقلة عن الأخرى.
 */
@Entity(tableName = "customers")
data class Customer(
    @PrimaryKey val id: String,
    val name: String,
    val phone: String = "",
    val openingBalanceIqd: Double = 0.0,
    val openingBalanceUsd: Double = 0.0,
    val notes: String = "",
    val createdAt: Long = System.currentTimeMillis(),
)
