use anchor_lang::prelude::*;
use std::mem::size_of;

declare_id!("6urrPCjcrQ1xaxbAJGMTtvZfA9wbMqQbEArKnVUHhYTs");

#[program]
pub mod cross_pile {
    use super::*;

    const CROSS_PILE_PDA_SEED: &[u8] = b"cross_pile";

    pub fn create_coin(
        ctx: Context<CreateCoin>,
        coin_bump: u8,
        req_bump: u8,
        vault_bump: u8,
    ) -> ProgramResult {
        let authority_key = ctx.accounts.initiator.key();
        { 
            let coin = &mut ctx.accounts.coin.load_init()?;
            let clock: Clock = Clock::get().unwrap();
            
            coin.initiator = authority_key;
            coin.acceptor = ctx.accounts.acceptor.key();
            coin.is_flipping = false;
            coin.created_at = clock.unix_timestamp;
            coin.bump = coin_bump;
        }

        let cpi_accounts = sol_rng::cpi::accounts::TransferAuthority {
            requester: ctx.accounts.requester.to_account_info(),
            authority: ctx.accounts.initiator.to_account_info(),
            new_authority: ctx.accounts.coin.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info()
        };

        let cpi_context = CpiContext::new(
            ctx.accounts.sol_rng_program.clone(),
            cpi_accounts
        );

        sol_rng::cpi::transfer_authority(cpi_context)?;

        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.initiator.key(),
            &ctx.accounts.vault.key(),
            100000,
        );

        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.initiator.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        Ok(())
    }


    pub fn approve_flip<'key, 'accounts, 'remaining, 'info>(
        ctx: Context<'key, 'accounts, 'remaining, 'info, ApproveFlip<'info>>
    ) -> ProgramResult {
        {
            let ix = anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.authority.key(),
                &ctx.accounts.vault.key(),
                100000,
            );

            anchor_lang::solana_program::program::invoke(
                &ix,
                &[
                    ctx.accounts.authority.to_account_info(),
                    ctx.accounts.vault.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        let coin_acc = &ctx.remaining_accounts[0];

        let cpi_accounts = sol_rng::cpi::accounts::RequestRandom {
            requester: ctx.accounts.requester.to_account_info(),
            vault: ctx.accounts.oracle_vault.clone(),
            authority: coin_acc.to_account_info(),
            oracle: ctx.accounts.oracle.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info()
        };

        let (_coin_authority, coin_bump) =
            Pubkey::find_program_address(&[b"coin-seed".as_ref(), ctx.accounts.initiator.key.as_ref()], &ctx.program_id);

        let coin_seeds = &[
            b"coin-seed".as_ref(),
            ctx.accounts.initiator.key.as_ref(),
            &[coin_bump]
        ];

        let signer = &[
            &coin_seeds[..]
        ];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.sol_rng_program.clone(),
            cpi_accounts,
            signer
        );

        sol_rng::cpi::request_random(cpi_context)?;

        Ok(())
    }

    pub fn reveal_coin(
        ctx: Context<RevealCoin>
    ) -> ProgramResult {

        // let coin_loader: Loader<Coin> = Loader::try_from_unchecked(ctx.program_id, &ctx.remaining_accounts[0]).unwrap();
        // let coin_key = coin_loader.key();
        // let coin = coin_loader.load_mut()?;

        // ctx.accounts.requester.data;

        // **flip.to_account_info().try_borrow_mut_lamports()? -= flip.amount;
        // **ctx.accounts.checker.try_borrow_mut_lamports()? += flip.amount;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(coin_bump: u8, req_bump: u8, vault_bump: u8)]
pub struct CreateCoin<'info> {
    #[account(
        init, 
        seeds = [b"coin-seed".as_ref(), initiator.key().as_ref()],
        bump = coin_bump,
        payer = initiator,
        space = 8 + size_of::<Coin>()
    )]
    pub coin: AccountLoader<'info, Coin>,
    #[account(
        init, 
        seeds = [b"vault-seed".as_ref(), initiator.key().as_ref()],
        bump = vault_bump,
        payer = initiator,
        space = 8 + size_of::<Vault>()
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub requester: AccountInfo<'info>,
    #[account(mut, signer)]
    pub initiator: AccountInfo<'info>,
    pub acceptor: AccountInfo<'info>,
    pub oracle: AccountInfo<'info>,
    pub oracle_vault: AccountInfo<'info>,
    pub sol_rng_program: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveFlip<'info> {
    #[account(mut, signer)]
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub vault: AccountInfo<'info>,
    pub initiator: AccountInfo<'info>,
    #[account(mut)]
    pub requester: AccountInfo<'info>,
    #[account(mut)]
    pub oracle: AccountInfo<'info>,
    #[account(mut)]
    pub oracle_vault: AccountInfo<'info>,
    pub sol_rng_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealCoin<'info> {
    #[account(mut, signer)]
    pub initiator_or_acceptor: AccountInfo<'info>,
    #[account(mut)]
    pub other: AccountInfo<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub requester: AccountInfo<'info>,
}

#[account(zero_copy)]
pub struct Coin {
    pub initiator: Pubkey,
    pub acceptor: Pubkey,
    pub is_flipping: bool,
    pub is_cross: bool,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
pub struct Vault {
    pub bump: u8,
}

#[error]
pub enum ErrorCode {
    #[msg("You are not authorized to complete this transaction")]
    Unauthorized,
    #[msg("You have already completed this transaction")]
    AlreadyCompleted,
    #[msg("A request is already in progress. Only one request may be made at a time")]
    InflightRequest,
    #[msg("The Oracle you make the request with must be the same as initialization")]
    WrongOracle,
}