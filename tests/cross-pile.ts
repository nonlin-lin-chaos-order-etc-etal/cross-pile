import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { IDL as SOLRAND_IDL } from '../../solrandhypn/target/types/solrandhypn';
import { MockOracleSession } from "../../solrandhypn/app/sessions.js";
import { CrossPile } from '../target/types/cross_pile';
import { randomBytes } from 'crypto';
import { assert } from "chai";

const PROGRAM_ID = 'CrkGQLM8mnWxUV2bGXacvFtnk3oVyeP6grRyFgu6XJ9G';

describe('cross-pile', () => {
    const trace = (m) => {
       console.log("TRACE:", m);
    };
    trace("point1");
    const ENV = 'http://localhost:8899';
    trace("point2");
    const solrandId = new anchor.web3.PublicKey(PROGRAM_ID);
    trace(`point3: 'PROGRAM_ID'=='${PROGRAM_ID}'`);

    function createProvider(keyPair) {
        let solConnection = new anchor.web3.Connection(ENV);
        let walletWrapper = new anchor.Wallet(keyPair);
        return new anchor.Provider(solConnection, walletWrapper, {
            preflightCommitment: 'recent',
        });
    }

    async function getBalance(prov, key) {
        anchor.setProvider(prov);
        return await prov.connection.getBalance(key, "confirmed");
    }

    const userKeyPair = anchor.web3.Keypair.generate();
    const user2KeyPair = anchor.web3.Keypair.generate();
    const oracle = anchor.web3.Keypair.generate();
    const oracleSession = new MockOracleSession(oracle, SOLRAND_IDL, solrandId, ENV);

    trace(`point b.2 user key pair`);
    let provider = createProvider(userKeyPair);
    trace(`point b.3 user 2 key pair`);
    let provider2 = createProvider(user2KeyPair);
    trace(`point b.4`);

    const program = anchor.workspace.CrossPile as Program<CrossPile>;
    trace(`crosspile program id: '${program.programId}'`)
    const userProgram = new anchor.Program(program.idl, program.programId, provider);
    const user2Program = new anchor.Program(program.idl, program.programId, provider2);

    const oraclePubkey = oracle.publicKey;
    const solrandProgram = new anchor.Program(SOLRAND_IDL, solrandId, provider);
    trace(`solrand program id: '${solrandProgram.programId}'`)

    const amount = new anchor.BN(100000000);
    const airdropAmount = 10000000000; // Should be more than betting amount
    let reqAccount, reqBump;
    let reqVaultAccount, reqVaultBump;
    let coinAccount, coinBump;
    let vaultAccount, vaultBump;

    anchor.setProvider(provider);
    
    trace(`point: unit tests begin...`);

    it('Set up tests', async () => {
        console.log('User Pubkey: ', userKeyPair.publicKey.toString());
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(userKeyPair.publicKey, airdropAmount),
            "confirmed"
        );

        console.log('User 2 Pubkey: ', user2KeyPair.publicKey.toString());
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(user2KeyPair.publicKey, airdropAmount),
            "confirmed"
        );

        console.log('Oracle Pubkey', oracle.publicKey.toString());
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(oracle.publicKey, airdropAmount),
            "confirmed"
        );

        [reqAccount, reqBump] = await anchor.web3.PublicKey.findProgramAddress(
            [Buffer.from("r-seed"), userKeyPair.publicKey.toBuffer()],
            solrandId
            );
        trace(`r-seed reqAcct='${reqAccount}'`);

        [reqVaultAccount, reqVaultBump] = await anchor.web3.PublicKey.findProgramAddress(
            [Buffer.from("v-seed"), userKeyPair.publicKey.toBuffer()],
            solrandId,
            );
        trace(`v-seed reqVaultAcct='${reqVaultAccount}'`);


        await solrandProgram.rpc.initialize(
            reqBump,
            reqVaultBump,
            {
                accounts: {
                    requester: reqAccount,
                    vault: reqVaultAccount,
                    authority: userKeyPair.publicKey,
                    oracle: oraclePubkey,
                    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                    systemProgram: anchor.web3.SystemProgram.programId,
                },
                signers: [userKeyPair],
            }
        );
    });

    it('Create a coin!', async () => {
        trace(`point cc0`);
        [coinAccount, coinBump] = await anchor.web3.PublicKey.findProgramAddress(
            [Buffer.from("coin-seed"), userKeyPair.publicKey.toBuffer()],
            program.programId
            );
        trace(`point cc1 ${coinAccount}`);

        [vaultAccount, vaultBump] = await anchor.web3.PublicKey.findProgramAddress(
            [Buffer.from("vault-seed"), userKeyPair.publicKey.toBuffer()],
            program.programId
            );
        trace(`point cc2 ${vaultAccount}`);

        console.log('Coin account: ', coinAccount.toString());
        console.log('Req account: ', reqAccount.toString());
        console.log('Vault account: ', vaultAccount.toString());

        await program.rpc.createCoin(
            coinBump,
            reqBump,
            vaultBump,
            amount,
            {
                accounts: {
                    coin: coinAccount,
                    vault: vaultAccount,
                    requester: reqAccount,
                    initiator: userKeyPair.publicKey,
                    acceptor: user2KeyPair.publicKey,
                    oracle: oraclePubkey,
                    oracleVault: reqVaultAccount,
                    solrandProgram: solrandId,
                    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                    systemProgram: anchor.web3.SystemProgram.programId,
                },
                signers: [userKeyPair],
            }
        );

        let userBalance = await getBalance(provider, userKeyPair.publicKey);
        
        trace(`cc pint assert balance #1`)
        assert(userBalance < airdropAmount);

        console.log('User Balance: ', userBalance);
    });

    it('Approve a flip', async () => {
        anchor.setProvider(provider2);
        await user2Program.rpc.approveFlip(
            {
                accounts: {
                    authority: user2KeyPair.publicKey,
                    vault: vaultAccount,
                    initiator: userKeyPair.publicKey,
                    requester: reqAccount,
                    oracle: oraclePubkey,
                    oracleVault: reqVaultAccount,
                    solrandProgram: solrandId,
                    systemProgram: anchor.web3.SystemProgram.programId,
                },
                remainingAccounts: [
                    {
                        pubkey: coinAccount,
                        isWritable: true,
                        isSigner: false,
                    },
                ],
                signers: [user2KeyPair],
            },
        );

        let user2Balance = await getBalance(provider2, user2KeyPair.publicKey);
        assert(user2Balance < airdropAmount + amount.toNumber());

        console.log('User 2 Balance: ', user2Balance);
    });

    it('Oracle responds to request', async () => {
        let randomNumber = randomBytes(64);
        randomNumber[0] = 0; // Force winner to be acceptor

        let requester = { publicKey: reqAccount };

        await oracleSession.publishRandom(requester, randomNumber);
    });

    it('Reveal the result', async () => {
        anchor.setProvider(provider2);
        await user2Program.rpc.revealCoin(
            {
                accounts: {
                    initiator: userKeyPair.publicKey,
                    acceptor: user2KeyPair.publicKey,
                    vault: vaultAccount,
                    requester: reqAccount,
                    authority: user2KeyPair.publicKey,
                    solrandProgram: solrandId,
                    systemProgram: anchor.web3.SystemProgram.programId,
                },
                remainingAccounts: [
                    {
                        pubkey: coinAccount,
                        isWritable: true,
                        isSigner: false,
                    },
                ],
                signers: [user2KeyPair],
            },
        );
        
        let userBalance = await getBalance(provider, userKeyPair.publicKey);
        let user2Balance = await getBalance(provider2, user2KeyPair.publicKey);

        console.log('User Balance: ', userBalance);
        console.log('User 2 Balance: ', user2Balance);

        assert(userBalance < airdropAmount + amount.toNumber());
        assert(user2Balance >= airdropAmount + amount.toNumber() - 3 * 5000); // account for transaction cost
    });
});
