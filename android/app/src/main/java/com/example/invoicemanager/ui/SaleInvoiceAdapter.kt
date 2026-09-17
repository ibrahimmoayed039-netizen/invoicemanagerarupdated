package com.example.invoicemanager.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.example.invoicemanager.R
import com.example.invoicemanager.data.SaleInvoice
import com.example.invoicemanager.databinding.ItemSaleInvoiceBinding
import java.text.NumberFormat
import java.util.Locale

class SaleInvoiceAdapter(
    private val customerNames: Map<String, String>,
    private val onClick: (SaleInvoice) -> Unit,
    private val onLongClick: (SaleInvoice) -> Boolean,
    private val onSettle: (SaleInvoice) -> Unit,
) : ListAdapter<SaleInvoice, SaleInvoiceAdapter.VH>(DIFF) {

    class VH(val binding: ItemSaleInvoiceBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val binding = ItemSaleInvoiceBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return VH(binding)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val inv = getItem(position)
        val ctx = holder.itemView.context
        val nf = NumberFormat.getNumberInstance(Locale.US)

        holder.binding.textInvoiceNumber.text = inv.invoiceNumber
        holder.binding.textCustomer.text = customerNames[inv.customerId] ?: "عميل محذوف"
        val unit = if (inv.currency == "USD") "$" else "د.ع"
        holder.binding.textAmounts.text =
            "الإجمالي: ${nf.format(inv.total)} $unit — المتبقي: ${nf.format(inv.remaining)} $unit"

        val (statusText, bg, fg) = when (inv.status) {
            "paid" -> Triple("مسددة", R.color.tint_paid, R.color.status_paid)
            "partial" -> Triple("جزئية", R.color.tint_partial, R.color.status_partial)
            else -> Triple("غير مسددة", R.color.tint_unpaid, R.color.status_unpaid)
        }
        holder.binding.textStatus.text = statusText
        holder.binding.textStatus.setTextColor(ContextCompat.getColor(ctx, fg))
        holder.binding.rowRoot.setBackgroundColor(ContextCompat.getColor(ctx, bg))

        holder.itemView.setOnClickListener { onClick(inv) }
        holder.itemView.setOnLongClickListener { onLongClick(inv) }
        holder.binding.btnSettle.visibility = if (inv.status == "paid") android.view.View.GONE else android.view.View.VISIBLE
        holder.binding.btnSettle.setOnClickListener { onSettle(inv) }
    }

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<SaleInvoice>() {
            override fun areItemsTheSame(a: SaleInvoice, b: SaleInvoice) = a.id == b.id
            override fun areContentsTheSame(a: SaleInvoice, b: SaleInvoice) = a == b
        }
    }
}
