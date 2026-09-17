package com.example.invoicemanager.data

import androidx.lifecycle.LiveData
import androidx.room.*

@Dao
interface PurchaseInvoiceDao {
    @Query("SELECT * FROM purchase_invoices ORDER BY date DESC")
    fun observeAll(): LiveData<List<PurchaseInvoice>>

    @Query("SELECT * FROM purchase_invoices WHERE customerId = :customerId ORDER BY date DESC")
    fun observeForCustomer(customerId: String): LiveData<List<PurchaseInvoice>>

    @Query("SELECT * FROM purchase_invoices WHERE customerId = :customerId")
    suspend fun getForCustomerOnce(customerId: String): List<PurchaseInvoice>

    @Query("SELECT * FROM purchase_invoices")
    suspend fun getAllOnce(): List<PurchaseInvoice>

    @Query("SELECT * FROM purchase_invoices WHERE id = :id")
    suspend fun getById(id: String): PurchaseInvoice?

    @Query("SELECT COUNT(*) FROM purchase_invoices")
    suspend fun count(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(invoice: PurchaseInvoice)

    @Delete
    suspend fun delete(invoice: PurchaseInvoice)
}
