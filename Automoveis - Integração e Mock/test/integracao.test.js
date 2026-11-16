import app from '../src/app.js';
import request from 'supertest'; // faz requisições HTTP para o app
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connection } from '../src/configs/Database.js';
import { clearDatabase } from './utils/clearDatabase.js';

import axios from 'axios'; // foi importado para poder ser mockado, já que o clienteController chama o consultarCep, que chama o axios.get

import { MontadoraFactory } from './factories/MontadoraFactory.js';
import { ClienteFactory } from './factories/ClienteFactory.js';
import { VeiculoFactory } from './factories/VeiculoFactory.js';

// Este serve para mockar o axios.get, que é usado no consultarCep, que é chamado pelo clienteController. Assim, não preciso depender do serviço externo ViaCEP para os testes.
vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

// Status que a API devolve quando o erro é de validação/banco (hoje tudo cai no catch e vira 500).
// Se um dia o projeto passar a devolver 400/409, basta mudar aqui.
const STATUS_ERRO = 500;

// Resposta simulada do ViaCEP (o consultarCep usa logradouro, bairro, localidade e uf)
const respostaViaCep = {
    logradouro: 'Rua Teste',
    bairro: 'Bairro Teste',
    localidade: 'Cidade Teste',
    uf: 'SP'
};

const clienteValido = {
    nome: 'Florisvaldo Junior',
    cpf: '12345678000',
    cep: '13185880',
    numero: 123,
    complemento: 'Apenas um teste!'
};

function mockViaCepSucesso(dados = respostaViaCep) {
    axios.get.mockResolvedValue({ data: dados });
}

// O ViaCEP responde 200 com { erro: true } quando o CEP não existe
function mockViaCepCepInexistente() {
    axios.get.mockResolvedValue({ data: { erro: true } });
}

// Simula o serviço fora do ar / sem rede
function mockViaCepIndisponivel() {
    axios.get.mockRejectedValue(new Error('Network Error'));
}

// Cria um cliente direto no banco sem passar pela API/ViaCEP
function criarCliente(nome = 'Florisvaldo Junior', cpf = '12345678000') {
    return ClienteFactory.create(
        nome, cpf, '13185880', 'Rua Teste', 'Bairro Teste', 'Cidade Teste', 'SP', '123', 'Apenas um teste!'
    );
}

// Cria um veículo direto no banco
function criarVeiculo(cliente, montadora, placa = 'EAG-2356', modelo = 'Corolla') {
    return VeiculoFactory.create(modelo, placa, 2010, 'Preto', 20000.00, cliente.id, montadora.id);
}

async function buscarPorId(tabela, id) {
    const [rows] = await connection.execute(`SELECT * FROM ${tabela} WHERE Id = ?`, [id]);
    return rows[0];
}

async function contar(tabela) {
    const [rows] = await connection.execute(`SELECT COUNT(*) AS total FROM ${tabela}`);
    return Number(rows[0].total);
}


// Sobre as Montadoras


describe('API de montadoras', () => {
    let toyota, honda, ford;

    beforeEach(async () => {
        toyota = await MontadoraFactory.create('Toyota', 'Japão');
        honda = await MontadoraFactory.create('Honda', 'Japão');
        ford = await MontadoraFactory.create('Ford', 'USA');

        vi.clearAllMocks();
    });

    afterEach(async () => {
        await clearDatabase();

        vi.resetAllMocks();
    })

    it('01 - deve criar uma montadora com sucesso', async () => {
        const response = await request(app)
        .post('/montadoras')
        .send({
            nome: 'Ferrari',
            pais: 'Itália'
        });

        expect(response.status).toBe(201);
        expect(response.body.message).toBe('Montadora criada com sucesso');
        expect(response.body.data).toHaveProperty('insertId');

        const montadora = await buscarPorId('montadoras', response.body.data.insertId);
        expect(montadora.Nome).toBe('Ferrari');
        expect(montadora.Pais).toBe('Itália');
    })

    it('02 - deve listar as montadoras cadastradas ordenadas por nome', async () => {
        const response = await request(app).get('/montadoras');

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(3);
        expect(response.body.data.map(m => m.Nome)).toEqual(['Ford', 'Honda', 'Toyota']);
    })

    it('03 - deve atualizar os dados de uma montadora', async () => {
        const ferrari = await MontadoraFactory.create('Ferrari', 'Itália');

        const response = await request(app)
        .put(`/montadoras?id=${ferrari.id}`)
        .send({
            nome: 'Ferrari SA',
            pais: 'Itália'
        });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Montadora atualizada com sucesso');

        const montadora = await buscarPorId('montadoras', ferrari.id);
        expect(montadora.Nome).toBe('Ferrari SA');
        expect(montadora.Pais).toBe('Itália');
    })

    it('04 - deve excluir uma montadora sem veículos vinculados', async () => {
        const ferrari = await MontadoraFactory.create('Ferrari', 'Itália');

        const response = await request(app).delete(`/montadoras/${ferrari.id}`);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Montadora deletada com sucesso');

        const montadora = await buscarPorId('montadoras', ferrari.id);
        expect(montadora).toBeUndefined();
        expect(await contar('montadoras')).toBe(3); // as montadoras do beforeEach continuam lá
    })

    it('14 - não deve cadastrar montadora com nome inválido', async () => {
        const response = await request(app)
        .post('/montadoras')
        .send({
            nome: 'Fe',
            pais: 'Itália'
        });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Nome inválido');
        expect(await contar('montadoras')).toBe(3); // nada novo foi cadastrado
    })

    it('15 - não deve excluir montadora vinculada a um veículo', async () => {
        const cliente = await criarCliente();
        await VeiculoFactory.create('Corolla', 'EAG-2356', 2010, 'Preto', 20000.00, cliente.id, toyota.id);

        const response = await request(app).delete(`/montadoras/${toyota.id}`);

        expect(response.status).toBe(500);
        expect(response.body.error).toMatch(/foreign key/i); // violação de integridade referencial

        const montadora = await buscarPorId('montadoras', toyota.id);
        expect(montadora).toBeDefined();
        expect(montadora.Nome).toBe('Toyota');
    })
})


// Sobre os Clientes


describe('API de clientes', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await clearDatabase();

        vi.resetAllMocks();
    })

    it('05 - deve cadastrar cliente com CEP válido', async () => { 
        mockViaCepSucesso();

        const response = await request(app)
        .post('/clientes')
        .send({
            nome: 'Florisvaldo Junior',
            cpf: '12345678000',
            cep: '13185880',
            numero: 123,
            complemento: 'Apenas um teste!'
        });

        expect(response.status).toBe(201);
        expect(response.body.message).toBe('Cliente criado com sucesso');
        expect(response.body.data).toHaveProperty('insertId');
        expect(axios.get).toHaveBeenCalledWith('https://viacep.com.br/ws/13185880/json/');

        // endereço preenchido de acordo com o retorno do CEP
        const cliente = await buscarPorId('clientes', response.body.data.insertId);
        expect(cliente).toMatchObject({
            Nome: 'Florisvaldo Junior',
            CPF: '12345678000',
            CEP: '13185880',
            Logradouro: 'Rua Teste',
            Bairro: 'Bairro Teste',
            Cidade: 'Cidade Teste',
            UF: 'SP',
            Numero: '123',
            Complemento: 'Apenas um teste!'
        });
    })

    it('06 - não deve cadastrar cliente com CEP inexistente', async () => {
        mockViaCepCepInexistente();

        const response = await request(app).post('/clientes').send(clienteValido);

        expect(response.status).toBe(STATUS_ERRO);
        expect(response.body).toHaveProperty('error');
        expect(await contar('clientes')).toBe(0);
    })

    it('07 - não deve cadastrar cliente quando o ViaCEP está indisponível', async () => {
        mockViaCepIndisponivel();

        const response = await request(app).post('/clientes').send(clienteValido);

        expect(response.status).toBe(STATUS_ERRO);
        expect(response.body).toHaveProperty('error');
        expect(await contar('clientes')).toBe(0);
    })

    it('08 - deve listar os clientes cadastrados', async () => {
        await criarCliente('Ana Souza', '11111111111');
        await criarCliente('Bruno Lima', '22222222222');

        const response = await request(app).get('/clientes');

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2);
        expect(response.body.data.map(c => c.Nome)).toEqual(
            expect.arrayContaining(['Ana Souza', 'Bruno Lima'])
        );
    })

    it('09 - não deve excluir cliente vinculado a um veículo', async () => {
        const cliente = await criarCliente();
        const toyota = await MontadoraFactory.create('Toyota', 'Japão');
        await criarVeiculo(cliente, toyota);

        const response = await request(app).delete(`/clientes/${cliente.id}`);

        expect(response.status).toBe(STATUS_ERRO);
        expect(response.body.error).toMatch(/foreign key/i);
        expect(await buscarPorId('clientes', cliente.id)).toBeDefined();
    })
})


// Sobre os Veículos


describe('API de veículos', () => {
    let cliente, toyota, veiculoValido;

    beforeEach(async () => {
        cliente = await criarCliente();
        toyota = await MontadoraFactory.create('Toyota', 'Japão');

        veiculoValido = {
            modelo: 'Corolla',
            placa: 'EAG-2356',
            ano: 2010,
            cor: 'Preto',
            valor: 20000.00,
            idCliente: cliente.id,
            idMontadora: toyota.id
        };

        vi.clearAllMocks();
    });

    afterEach(async () => {
        await clearDatabase();

        vi.resetAllMocks();
    })

    it('10 - deve cadastrar veículo vinculado a cliente e montadora', async () => {
        const response = await request(app).post('/veiculos').send(veiculoValido);

        expect(response.status).toBe(201);
        expect(response.body.data).toHaveProperty('insertId');

        const veiculo = await buscarPorId('veiculos', response.body.data.insertId);
        expect(veiculo).toMatchObject({
            Modelo: 'Corolla',
            Placa: 'EAG-2356',
            Ano: 2010,
            Cor: 'Preto',
            IdCliente: cliente.id,
            IdMontadora: toyota.id
        });
        expect(Number(veiculo.Valor)).toBe(20000); // DECIMAL volta como string do mysql2
    })

    it('11 - deve listar os veículos cadastrados', async () => {
        await criarVeiculo(cliente, toyota, 'AAA-1111', 'Corolla');
        await criarVeiculo(cliente, toyota, 'BBB-2222', 'Yaris');

        const response = await request(app).get('/veiculos');

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2);
    })

    it('12 - não deve cadastrar veículo com montadora inexistente', async () => {
        const response = await request(app)
        .post('/veiculos')
        .send({ ...veiculoValido, idMontadora: 9999 });

        expect(response.status).toBe(STATUS_ERRO);
        expect(response.body.error).toMatch(/foreign key/i);
        expect(await contar('veiculos')).toBe(0);
    })

    it('13 - deve atualizar os dados de um veículo', async () => {
        const veiculo = await criarVeiculo(cliente, toyota);

        const response = await request(app)
        .put(`/veiculos?id=${veiculo.id}`)
        .send({ ...veiculoValido, cor: 'Branco', valor: 18000.50 });

        expect(response.status).toBe(200);

        const atualizado = await buscarPorId('veiculos', veiculo.id);
        expect(atualizado.Cor).toBe('Branco');
        expect(Number(atualizado.Valor)).toBe(18000.5);
    })
})


// Fluxo completo pela API (sem factories)


describe('Fluxo completo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await clearDatabase();

        vi.resetAllMocks();
    })

    it('16 - deve cadastrar montadora, cliente e veículo e respeitar a ordem de exclusão', async () => {
        mockViaCepSucesso();

        const montadora = await request(app).post('/montadoras').send({ nome: 'Chevrolet', pais: 'USA' });
        expect(montadora.status).toBe(201);

        const cliente = await request(app).post('/clientes').send({
            nome: 'Carlos Lima',
            cpf: '98765432100',
            cep: '13185880',
            numero: 45
        });
        expect(cliente.status).toBe(201);

        const idMontadora = montadora.body.data.insertId;
        const idCliente = cliente.body.data.insertId;

        const veiculo = await request(app).post('/veiculos').send({
            modelo: 'Onix',
            placa: 'XYZ-9K88',
            ano: 2023,
            cor: 'Branco',
            valor: 85000,
            idCliente,
            idMontadora
        });
        expect(veiculo.status).toBe(201);
        const idVeiculo = veiculo.body.data.insertId;

        // com o veículo cadastrado, montadora e cliente ficam protegidos
        expect((await request(app).delete(`/montadoras/${idMontadora}`)).status).toBe(STATUS_ERRO);
        expect((await request(app).delete(`/clientes/${idCliente}`)).status).toBe(STATUS_ERRO);

        // removendo na ordem correta, tudo é excluído
        expect((await request(app).delete(`/veiculos/${idVeiculo}`)).status).toBe(200);
        expect((await request(app).delete(`/clientes/${idCliente}`)).status).toBe(200);
        expect((await request(app).delete(`/montadoras/${idMontadora}`)).status).toBe(200);

        expect(await contar('veiculos')).toBe(0);
        expect(await contar('clientes')).toBe(0);
        expect(await contar('montadoras')).toBe(0);
    })
})