package com.example.invoicemanager.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.room.migration.Migration

@Database(
    entities = [Customer::class, SaleInvoice::class, Payment::class, PurchaseInvoice::class, AppSettings::class],
    version = 3,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun customerDao(): CustomerDao
    abstract fun saleInvoiceDao(): SaleInvoiceDao
    abstract fun paymentDao(): PaymentDao
    abstract fun purchaseInvoiceDao(): PurchaseInvoiceDao
    abstract fun appSettingsDao(): AppSettingsDao

    companion object {
        @Volatile private var INSTANCE: AppDatabase? = null

        // إضافة جدول فواتير الشراء — لا يمس أي بيانات موجودة بالجداول الأخرى.
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `purchase_invoices` (
                        `id` TEXT NOT NULL,
                        `invoiceNumber` TEXT NOT NULL,
                        `customerId` TEXT NOT NULL,
                        `currency` TEXT NOT NULL DEFAULT 'IQD',
                        `total` REAL NOT NULL,
                        `discount` REAL NOT NULL DEFAULT 0,
                        `paidAmount` REAL NOT NULL DEFAULT 0,
                        `notes` TEXT NOT NULL DEFAULT '',
                        `date` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
            }
        }

        // إضافة جدول الإعدادات العامة (اسم المنشأة، الهاتف، العنوان، العملة) — صف واحد ثابت.
        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `app_settings` (
                        `id` INTEGER NOT NULL,
                        `companyName` TEXT NOT NULL DEFAULT '',
                        `companyPhone` TEXT NOT NULL DEFAULT '',
                        `companyAddress` TEXT NOT NULL DEFAULT '',
                        `currency` TEXT NOT NULL DEFAULT 'د.ع',
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
            }
        }

        fun getInstance(context: Context): AppDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "invoice-manager.db",
                ).addMigrations(MIGRATION_1_2, MIGRATION_2_3).build().also { INSTANCE = it }
            }
    }
}
