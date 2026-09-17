package com.example.invoicemanager.data

/** يقابل صف واحد بقائمة المستحقات (getDuesSummary بنسخة سطح المكتب). */
data class DuesRow(
    val customerId: String,
    val customerName: String,
    val theyOweUsIqd: Double,
    val theyOweUsUsd: Double,
)

data class DashboardSummary(
    val customersCount: Int,
    val saleInvoicesCount: Int,
    val totalSalesIqd: Double,
    val totalSalesUsd: Double,
    val totalDuesIqd: Double,
    val totalDuesUsd: Double,
)

/**
 * حسابات المستحقات ولوحة الملخص — تقابل getDuesSummary() وgetDashboardSummary() بنسخة سطح المكتب
 * (db.js)، بفارق أن نسخة أندرويد تحسب "الرصيد القديم المتبقي" من (الأصل − مجموع تسديدات الرصيد
 * القديم) بدل تعديل الحقل مباشرة، وتقتصر على المبيعات فقط (لا فواتير شراء بهذه النسخة).
 */
object DuesCalculator {
    suspend fun computeDues(db: AppDatabase): List<DuesRow> {
        val customers = db.customerDao().getAllOnce()
        val invoices = db.saleInvoiceDao().getAllOnce()
        val payments = db.paymentDao().getAllOnce()
        val paymentsByCustomer = payments.groupBy { it.customerId }
        val invoicesByCustomer = invoices.groupBy { it.customerId }

        return customers.mapNotNull { c ->
            val custPayments = paymentsByCustomer[c.id] ?: emptyList()
            val paidOpeningIqd = custPayments.filter { it.kind == "opening_payment" && it.currency == "IQD" }.sumOf { it.amount }
            val paidOpeningUsd = custPayments.filter { it.kind == "opening_payment" && it.currency == "USD" }.sumOf { it.amount }
            val remOpeningIqd = (c.openingBalanceIqd - paidOpeningIqd).coerceAtLeast(0.0)
            val remOpeningUsd = (c.openingBalanceUsd - paidOpeningUsd).coerceAtLeast(0.0)

            val custInvoices = invoicesByCustomer[c.id] ?: emptyList()
            val remInvIqd = custInvoices.filter { it.currency == "IQD" }.sumOf { (it.total - it.paidAmount).coerceAtLeast(0.0) }
            val remInvUsd = custInvoices.filter { it.currency == "USD" }.sumOf { (it.total - it.paidAmount).coerceAtLeast(0.0) }

            val totalIqd = remOpeningIqd + remInvIqd
            val totalUsd = remOpeningUsd + remInvUsd
            if (totalIqd > 0.0001 || totalUsd > 0.0001) {
                DuesRow(c.id, c.name, totalIqd, totalUsd)
            } else null
        }
    }

    suspend fun computeDashboard(db: AppDatabase): DashboardSummary {
        val invoices = db.saleInvoiceDao().getAllOnce()
        val customersCount = db.customerDao().getAllOnce().size
        val dues = computeDues(db)
        return DashboardSummary(
            customersCount = customersCount,
            saleInvoicesCount = invoices.size,
            totalSalesIqd = invoices.filter { it.currency == "IQD" }.sumOf { it.total },
            totalSalesUsd = invoices.filter { it.currency == "USD" }.sumOf { it.total },
            totalDuesIqd = dues.sumOf { it.theyOweUsIqd },
            totalDuesUsd = dues.sumOf { it.theyOweUsUsd },
        )
    }
}
