package com.example.invoicemanager.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.example.invoicemanager.data.Customer
import com.example.invoicemanager.databinding.ItemCustomerBinding

class CustomerAdapter(
    private val onClick: (Customer) -> Unit = {},
    private val onLongClick: (Customer) -> Boolean = { false },
) : ListAdapter<Customer, CustomerAdapter.VH>(DIFF) {

    class VH(val binding: ItemCustomerBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, position: Int): VH {
        val binding = ItemCustomerBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return VH(binding)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val c = getItem(position)
        holder.binding.textName.text = c.name
        holder.binding.textPhone.text = c.phone
        holder.itemView.setOnClickListener { onClick(c) }
        holder.itemView.setOnLongClickListener { onLongClick(c) }
    }

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<Customer>() {
            override fun areItemsTheSame(a: Customer, b: Customer) = a.id == b.id
            override fun areContentsTheSame(a: Customer, b: Customer) = a == b
        }
    }
}
