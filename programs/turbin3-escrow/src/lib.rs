use anchor_lang::prelude::*;
mod errors;
mod instructions;
mod state;

declare_id!("7dSEjWtRLoxTjQkAdKewrvZ14A4P5FVGNMbBNnq3pbY");

#[program]
pub mod turbin3_escrow {
    use super::*;
    pub use instructions::*;

    pub fn make(ctx: Context<Make>, seed: u64, receive: u64, amount: u64) -> Result<()> {
        crate::instructions::make::handler(ctx, seed, receive, amount)
    }

    pub fn take(ctx: Context<Take>, seed: u64) -> Result<()> {
        crate::instructions::take::handler(ctx, seed)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        crate::instructions::refund::handler(ctx)
    }
}
