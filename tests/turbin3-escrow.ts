import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Turbin3Escrow } from "../target/types/turbin3_escrow";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { randomBytes } from "crypto";
import { assert } from "chai";

describe("turbin3-escrow", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const connection = provider.connection;
  const program = anchor.workspace.Turbin3Escrow as Program<Turbin3Escrow>;

  const maker = Keypair.generate();
  const taker = Keypair.generate();
  const mintA = Keypair.generate();
  const mintB = Keypair.generate();

  const seed = new anchor.BN(randomBytes(8));
  const amount = new anchor.BN(1_000_000);
  const receive = new anchor.BN(2_000_000);

  const [escrow] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      maker.publicKey.toBuffer(),
      seed.toArrayLike(Buffer, "le", 8),
    ],
    program.programId,
  );

  const vault = getAssociatedTokenAddressSync(mintA.publicKey, escrow, true);
  const makerAtaA = getAssociatedTokenAddressSync(
    mintA.publicKey,
    maker.publicKey,
  );
  const takerAtaB = getAssociatedTokenAddressSync(
    mintB.publicKey,
    taker.publicKey,
  );
  const takerAtaA = getAssociatedTokenAddressSync(
    mintA.publicKey,
    taker.publicKey,
  );
  const makerAtaB = getAssociatedTokenAddressSync(
    mintB.publicKey,
    maker.publicKey,
  );

  it("Setup Mints and Tokens", async () => {
    const airdropMaker = await connection.requestAirdrop(
      maker.publicKey,
      2 * LAMPORTS_PER_SOL,
    );
    const airdropTaker = await connection.requestAirdrop(
      taker.publicKey,
      2 * LAMPORTS_PER_SOL,
    );

    const latestMakerBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature: airdropMaker,
      ...latestMakerBlockhash,
    });

    const latestTakerBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature: airdropTaker,
      ...latestTakerBlockhash,
    });

    await createMint(connection, maker, maker.publicKey, null, 6, mintA);
    await createMint(connection, taker, taker.publicKey, null, 6, mintB);

    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        maker.publicKey,
        makerAtaA,
        maker.publicKey,
        mintA.publicKey,
      ),
      createAssociatedTokenAccountInstruction(
        taker.publicKey,
        takerAtaB,
        taker.publicKey,
        mintB.publicKey,
      ),
    );

    await anchor.web3.sendAndConfirmTransaction(connection, tx, [maker, taker]);

    await mintTo(
      connection,
      maker,
      mintA.publicKey,
      makerAtaA,
      maker.publicKey,
      1_000_000,
    );
    await mintTo(
      connection,
      taker,
      mintB.publicKey,
      takerAtaB,
      taker.publicKey,
      2_000_000,
    );
  });

  it("Make Escrow", async () => {
    await program.methods
      .make(seed, receive, amount)
      .accounts({
        maker: maker.publicKey,
        mintA: mintA.publicKey,
        mintB: mintB.publicKey,
        makerAAta: makerAtaA,
        vault: vault,
        escrow: escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    const escrowAccount = await program.account.escrow.fetch(escrow);
    assert.strictEqual(
      escrowAccount.maker.toString(),
      maker.publicKey.toString(),
    );
    assert.strictEqual(escrowAccount.recieve.toString(), receive.toString());

    const vaultAccount = await connection.getTokenAccountBalance(vault);
    assert.strictEqual(vaultAccount.value.amount, "1000000");
  });

  it("Take Escrow", async () => {
    await program.methods
      .take(seed)
      .accounts({
        taker: taker.publicKey,
        maker: maker.publicKey,
        mintA: mintA.publicKey,
        mintB: mintB.publicKey,
        escrow: escrow,
        vault: vault,
        takerAtaA: takerAtaA,
        takerAtaB: takerAtaB,
        makerAtaB: makerAtaB,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([taker])
      .rpc();

    const takerAtaAAccount = await connection.getTokenAccountBalance(takerAtaA);
    assert.strictEqual(takerAtaAAccount.value.amount, "1000000");

    const makerAtaBAccount = await connection.getTokenAccountBalance(makerAtaB);
    assert.strictEqual(makerAtaBAccount.value.amount, "2000000");

    const escrowInfo = await connection.getAccountInfo(escrow);
    assert.isNull(escrowInfo);
    const vaultInfo = await connection.getAccountInfo(vault);
    assert.isNull(vaultInfo);
  });

  it("Refund Escrow", async () => {
    const newSeed = new anchor.BN(randomBytes(8));
    const [newEscrow] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        maker.publicKey.toBuffer(),
        newSeed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
    const newVault = getAssociatedTokenAddressSync(
      mintA.publicKey,
      newEscrow,
      true,
    );

    await mintTo(
      connection,
      maker,
      mintA.publicKey,
      makerAtaA,
      maker.publicKey,
      1_000_000,
    );

    await program.methods
      .make(newSeed, receive, amount)
      .accounts({
        maker: maker.publicKey,
        mintA: mintA.publicKey,
        mintB: mintB.publicKey,
        makerAAta: makerAtaA,
        vault: newVault,
        escrow: newEscrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    await program.methods
      .refund()
      .accounts({
        maker: maker.publicKey,
        mintA: mintA.publicKey,
        escrow: newEscrow,
        vault: newVault,
        makerAtaA: makerAtaA,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    const makerAtaAAccount = await connection.getTokenAccountBalance(makerAtaA);
    assert.strictEqual(makerAtaAAccount.value.amount, "1000000");

    const escrowInfo = await connection.getAccountInfo(newEscrow);
    assert.isNull(escrowInfo);
  });
});
