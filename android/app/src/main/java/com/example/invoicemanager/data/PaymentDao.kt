package com.example.invoicemanager.data

import androidx.lifecycle.LiveData
import androidx.room.*

@Dao
interface PaymentDao {
    @Query("SELECT * FROM payments WHERE customerId = :customerId ORDER BY date DESC")
    fun observeForCustomer(customerId: String): LiveData<List<Payment>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(payment: Payment)

    @Delete
    suspend fun delete(payment: Payment)
}
