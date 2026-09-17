package com.example.invoicemanager.data

import androidx.lifecycle.LiveData
import androidx.room.*

@Dao
interface SaleInvoiceDao {
    @Query("SELECT * FROM sale_invoices ORDER BY date DESC")
    fun observeAll(): LiveData<List<SaleInvoice>>

    @Query("SELECT * FROM sale_invoices WHERE customerId = :customerId ORDER BY date DESC")
    fun observeForCustomer(customerId: String): LiveData<List<SaleInvoice>>

    @Query("SELECT * FROM sale_invoices WHERE customerId = :customerId")
    suspend fun getForCustomerOnce(customerId: String): List<SaleInvoice>

    @Query("SELECT * FROM sale_invoices")
    suspend fun getAllOnce(): List<SaleInvoice>

    @Query("SELECT * FROM sale_invoices WHERE id = :id")
    suspend fun getById(id: String): SaleInvoice?

    @Query("SELECT COUNT(*) FROM sale_invoices")
    suspend fun count(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(invoice: SaleInvoice)

    @Delete
    suspend fun delete(invoice: SaleInvoice)
}
