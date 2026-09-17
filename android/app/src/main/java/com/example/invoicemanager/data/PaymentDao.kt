package com.example.invoicemanager.data

import androidx.lifecycle.LiveData
import androidx.room.*

@Dao
interface PaymentDao {
    @Query("SELECT * FROM payments WHERE customerId = :customerId ORDER BY date DESC")
    fun observeForCustomer(customerId: String): LiveData<List<Payment>>

    @Query("SELECT * FROM payments WHERE customerId = :customerId")
    suspend fun getForCustomerOnce(customerId: String): List<Payment>

    @Query("SELECT * FROM payments")
    suspend fun getAllOnce(): List<Payment>

    @Query("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE customerId = :customerId AND currency = :currency AND kind = 'opening_payment'")
    suspend fun sumOpeningPayments(customerId: String, currency: String): Double

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(payment: Payment)

    @Delete
    suspend fun delete(payment: Payment)
}
