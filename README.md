# MIX PRO — Match Manager

Plataforma local para organizar MIX 5v5 de Counter-Strike 2, agora com histórico permanente de partidas e arquitetura de importação.

## Executar

Como o projeto não possui backend/dependências externas nesta versão:

```bash
python3 -m http.server 4173
```

Abra `http://localhost:4173`.

## O que foi preservado

- Seleção de 10 jogadores
- Seleção de capitães
- Sorteio de quem começa
- Draft 1-2-2-2-1
- Formação dos times
- Pick & Ban configurável
- Cadastro/edição/ativação de jogadores
- Cadastro e configuração de mapas
- Persistência local
- Fluxo de partida atual

## Novos recursos MIX PRO

- Menu Histórico
- Histórico persistente das partidas importadas
- Detalhamento de cada partida
- Perfil acumulado do jogador
- Estatísticas recalculadas a partir do histórico
- Identificação por SteamID/SteamID64/SteamID3
- Nome cadastrado separado do nickname da partida
- Proteção contra duplicação
- Exclusão com reversão/reconstrução das estatísticas
- Armazenamento do `rawMatchData`
- Tela de revisão antes de salvar
- Cadastro de jogadores desconhecidos durante a revisão
- Upload de arquivo para o campo de importação
- Testes automatizados do núcleo e do importador

## Importação CS2

O projeto **não inventa um parser para logs que ainda não foram fornecidos**.

O arquivo `src/matchImporter.js` possui um contrato normalizado e uma camada de validação. Quando o formato real gerado pelo servidor CS2 for fornecido, o adaptador desse formato deve converter os dados para esse contrato.

Isso evita que o sistema registre kills, ADR, rounds, MVPs ou qualquer outro dado que não esteja realmente presente no arquivo do servidor.

O fluxo já implementado é:

```text
dados → validação → identificação por SteamID → revisão → confirmação → histórico → reconstrução das estatísticas
```

## Contrato normalizado temporário

A entrada validada possui esta estrutura conceitual:

```json
{
  "match": {
    "id": "ID_FORNECIDO_PELO_SERVIDOR",
    "date": "2026-08-20T21:30:00-03:00",
    "map": "Mirage",
    "score": { "team1": 13, "team2": 9 },
    "winnerTeam": 1,
    "rounds": 22,
    "teams": [
      {
        "id": 1,
        "name": "Time 1",
        "players": [
          {
            "steamId": "STEAMID64",
            "steamId3": "[U:1:...]",
            "nickname": "Nick",
            "stats": {
              "kills": 24,
              "deaths": 12,
              "assists": 8
            }
          }
        ]
      },
      {
        "id": 2,
        "name": "Time 2",
        "players": []
      }
    ]
  }
}
```

Esse exemplo é apenas o contrato interno do importador, **não é uma afirmação de que o servidor CS2 gera esse formato**.

## Estatísticas

O sistema calcula automaticamente, quando os campos-base existem:

- K/D
- KDA
- HS%
- ADR acumulado por dano/rounds
- Winrate
- médias de Rating

Os campos ausentes permanecem sem valor inventado.

## Persistência

A versão original utilizava:

`cs2-mix-platform-v1`

A versão MIX PRO usa:

`cs2-mix-platform-v2`

A migração é compatível com o estado local anterior.

## Backend

A análise do projeto recebido mostrou que ele é uma aplicação frontend sem API/Node/Express/PostgreSQL.

Por isso não foi criado um segundo backend artificial.

A camada de histórico/importação foi estruturada para permitir uma futura API, por exemplo:

```text
POST /api/matches/import
GET  /api/matches
GET  /api/matches/:id
GET  /api/players/:id
GET  /api/players/:id/matches
GET  /api/rankings
```

Esses endpoints são uma arquitetura futura; **não estão sendo fingidos como implementados nesta versão local**.

## Testes

Executar:

```bash
npm test
```

A suíte atual cobre Draft, Pick & Ban, importação, estatísticas derivadas, duplicação e reconstrução dos agregados.


## Importação automática de ZIP MatchZy

O MIX PRO agora aceita diretamente o `.zip` exportado pelo servidor MatchZy.

### Fluxo
1. Administração → Importar partida.
2. `Selecionar ZIP/JSON`.
3. Escolha o ZIP da partida.
4. Clique em `Processar partida`.
5. Revise jogadores, mapa, placar e estatísticas.
6. Cadastre jogadores que ainda não existem pelo SteamID.
7. `Confirmar e salvar`.

O importador:
- lê `matchzy_*.json` dentro do ZIP no navegador;
- interpreta o `valve_backup`;
- agrupa arquivos pelo `matchid`;
- escolhe automaticamente o grupo com mais rounds quando o ZIP contém mais de uma partida;
- usa o snapshot final para evitar somar estatísticas acumuladas duas vezes;
- converte account-id numérico do MatchZy para SteamID64;
- calcula K/D, KDA, HS% e ADR;
- preserva os dados importados em `rawMatchData`;
- mantém a proteção contra duplicação.

O projeto usa apenas APIs nativas do navegador para abrir ZIPs (sem backend obrigatório para a importação).


Veja também `README-PUBLICACAO.md` para o passo a passo de publicação no GitHub Pages + Render + PostgreSQL.
