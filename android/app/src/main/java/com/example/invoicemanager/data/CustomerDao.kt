package com.example.invoicemanager.data

import androidx.lifecycle.LiveData
import androidx.room.*

@Dao
interface CustomerDao {
    @Query("SELECT * FROM customers ORDER BY name COLLATE NOCASE ASC")
    fun observeAll(): LiveData<List<Customer>>

    @Query("SELECT * FROM customers WHERE id = :id")
    suspend fun getById(id: String): Customer?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(customer: Customer)

    @Delete
    suspend fun delete(customer: Customer)
}
