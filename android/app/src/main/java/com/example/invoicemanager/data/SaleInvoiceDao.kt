package com.example.invoicemanager.data

import androidx.lifecycle.LiveData
import androidx.room.*

@Dao
interface SaleInvoiceDao {
    @Query("SELECT * FROM sale_invoices ORDER BY date DESC")
    fun observeAll(): LiveData<List<SaleInvoice>>

    @Query("SELECT * FROM sale_invoices WHERE customerId = :customerId ORDER BY date DESC")
    fun observeForCustomer(customerId: String): LiveData<List<SaleInvoice>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(invoice: SaleInvoice)

    @Delete
    suspend fun delete(invoice: SaleInvoice)
}
